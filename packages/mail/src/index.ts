import { classifyByHeaders, type FilterContext, type MailClass, type MessageHeaders } from "@flossamer/core";

/**
 * Mail ingestion (CN-01, EM-01 to EM-04). Provider-neutral: Gmail implements
 * `MailSource`; tests use an in-memory source.
 *
 * Guarantees from PRD section 10:
 * - Idempotent: a message is processed at most once, keyed by provider id.
 * - Resumable: progress is checkpointed after every page.
 * - Filter first: personal and automated mail never reaches a model, and
 *   personal mail's content is never fetched beyond headers.
 */

export interface MessageRef {
  id: string;
  threadId: string;
}

export interface SourceHeaders extends MessageHeaders {
  threadId: string;
  subject: string;
  snippet: string;
  /** ISO timestamp the provider received the message. */
  date: string;
  /** RFC 5322 Message-ID, for threading drafts. */
  messageId: string | null;
  /** Newsletter headers, for suggesting sources (IR-02). Headers only; bodies are never read. */
  listId?: string | null;
  listUnsubscribeValue?: string | null;
}

export interface MailSource {
  /** Pages of message refs, newest first, received after `after` (ISO date). */
  list(opts: { after: string; pageToken: string | null }): Promise<{ refs: MessageRef[]; nextPageToken: string | null }>;
  headers(id: string): Promise<SourceHeaders>;
  body(id: string): Promise<string>;
}

export interface Checkpoint {
  pageToken: string | null;
  processed: number;
  done: boolean;
}

export interface BackfillStore {
  loadCheckpoint(): Promise<Checkpoint | null>;
  saveCheckpoint(c: Checkpoint): Promise<void>;
  hasSeen(id: string): Promise<boolean>;
  markSeen(id: string, mailClass: MailClass): Promise<void>;
}

export interface BackfillHandlers {
  /** Small-model fallback for mail the header filter can't decide. */
  classifyUndecided(m: { from: string; subject: string; snippet: string }): Promise<Exclude<MailClass, "undecided">>;
  /** Receives business mail only. */
  onBusinessMessage(ref: MessageRef, headers: SourceHeaders, body: string): Promise<void>;
  /** Automated mail, headers only (the body is never fetched). Used to spot newsletters. */
  onAutomatedMessage?(ref: MessageRef, headers: SourceHeaders): Promise<void>;
  onProgress?(c: Checkpoint): void;
}

/** Process one page of messages. Safe to retry: already-seen messages are skipped. */
export async function processPage(opts: {
  source: MailSource;
  store: Pick<BackfillStore, "hasSeen" | "markSeen">;
  filter: FilterContext;
  handlers: BackfillHandlers;
  after: string;
  pageToken: string | null;
}): Promise<{ nextPageToken: string | null; processed: number }> {
  const { source, store, filter, handlers, after, pageToken } = opts;
  const page = await source.list({ after, pageToken });
  let processed = 0;

  for (const ref of page.refs) {
    if (await store.hasSeen(ref.id)) continue;

    const h = await source.headers(ref.id);
    let mailClass: MailClass = classifyByHeaders(h, filter);
    if (mailClass === "undecided") {
      mailClass = await handlers.classifyUndecided({ from: h.from, subject: h.subject, snippet: h.snippet });
    }
    if (mailClass === "business") {
      await handlers.onBusinessMessage(ref, h, await source.body(ref.id));
    } else if (mailClass === "automated") {
      await handlers.onAutomatedMessage?.(ref, h);
    }
    await store.markSeen(ref.id, mailClass);
    processed++;
  }

  return { nextPageToken: page.nextPageToken, processed };
}

/** Run a whole backfill in-process, checkpointing after every page. */
export async function backfill(opts: {
  source: MailSource;
  store: BackfillStore;
  filter: FilterContext;
  handlers: BackfillHandlers;
  after: string;
}): Promise<Checkpoint> {
  const { store, handlers } = opts;
  let checkpoint = (await store.loadCheckpoint()) ?? { pageToken: null, processed: 0, done: false };

  while (!checkpoint.done) {
    const page = await processPage({ ...opts, pageToken: checkpoint.pageToken });
    checkpoint = {
      pageToken: page.nextPageToken,
      processed: checkpoint.processed + page.processed,
      done: page.nextPageToken === null,
    };
    await store.saveCheckpoint(checkpoint);
    handlers.onProgress?.(checkpoint);
  }

  return checkpoint;
}

export * from "./gmail";
