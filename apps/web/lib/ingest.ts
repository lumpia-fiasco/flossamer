import { classifyMessage, extractThread, learnVoice, type ThreadExtraction } from "@flossamer/agents";
import { addDays, counterpartOf, detectAll, isoDay, type OpportunitySignal } from "@flossamer/core";
import * as repo from "@flossamer/db";
import { GmailSource, processPage, type SourceHeaders } from "@flossamer/mail";
import { feedFromNewsletterHeaders } from "@flossamer/radar";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { required } from "@/lib/env";

/**
 * Ingestion steps run by background jobs. Each function is one retryable unit
 * of work and is idempotent: re-running it after a failure changes nothing that
 * already succeeded. Every call is scoped to the studio named in the event.
 */

/** Threads active within this window get read in full and extracted. */
const EXTRACT_WINDOW_DAYS = 120;
/** New inquiries older than this aren't "new" any more. */
const INQUIRY_WINDOW_DAYS = 30;

export async function gmailFor(studioId: string, integrationId: string): Promise<GmailSource> {
  return new GmailSource({
    refreshToken: decrypt(await repo.getSecret(db(), studioId, integrationId)),
    clientId: required("AUTH_GOOGLE_ID"),
    clientSecret: required("AUTH_GOOGLE_SECRET"),
  });
}

const summarize = (h: SourceHeaders) => {
  const snippet = h.snippet.length > 180 ? `${h.snippet.slice(0, 177)}...` : h.snippet;
  return h.subject ? `${h.subject}: ${snippet}` : snippet;
};

/** EM-01, EM-04: one page of mail through the filter; business mail becomes interactions. */
export async function ingestPage(opts: {
  studioId: string;
  integrationId: string;
  after: string;
  pageToken: string | null;
}): Promise<{ nextPageToken: string | null; processed: number; newThreadIds: string[] }> {
  const conn = db();
  const studio = await repo.getStudio(conn, opts.studioId);
  const gmail = await gmailFor(studio.id, opts.integrationId);
  const filter = await repo.filterContext(conn, studio);
  const newThreadIds = new Set<string>();

  const result = await processPage({
    source: gmail,
    filter,
    after: opts.after,
    pageToken: opts.pageToken,
    store: {
      hasSeen: (id) => repo.hasSeen(conn, studio.id, id),
      markSeen: (id, mailClass) => repo.markSeen(conn, studio.id, id, mailClass),
    },
    handlers: {
      async classifyUndecided(m) {
        try {
          return (await classifyMessage(m)).mailClass;
        } catch {
          return "personal"; // When unsure, stay out of private mail.
        }
      },
      async onBusinessMessage(ref, h, body) {
        const sent = h.labels.includes("SENT");
        const rawCounterpart = sent ? (h.to[0] ?? "") : h.from;
        const personId = await repo.resolvePerson(conn, studio.id, rawCounterpart);
        await repo.insertInteraction(conn, studio.id, {
          id: ref.id,
          threadId: h.threadId,
          at: h.date,
          direction: sent ? "outbound" : "inbound",
          counterpart: counterpartOf(h),
          counterpartName: rawCounterpart.includes("<") ? rawCounterpart.split("<")[0]!.replace(/"/g, "").trim() || null : null,
          personId,
          subject: h.subject,
          summary: summarize(h),
          expectsReply: sent && repo.expectsReply(body),
        });
        newThreadIds.add(h.threadId);
      },
      // IR-02 (opt-in): suggest newsletters the user already gets, from headers alone.
      async onAutomatedMessage(_ref, h) {
        if (!studio.radar_newsletters) return;
        const feed = feedFromNewsletterHeaders({ listId: h.listId ?? null, listUnsubscribe: h.listUnsubscribeValue ?? null, from: h.from });
        if (feed) await repo.addSource(conn, studio.id, { ...feed, origin: "newsletter", enabled: false });
      },
    },
  });

  return { ...result, newThreadIds: [...newThreadIds] };
}

export async function recentThreadIds(studioId: string): Promise<string[]> {
  return repo.recentThreadIds(db(), studioId, addDays(new Date().toISOString(), -EXTRACT_WINDOW_DAYS));
}

function describe(x: ThreadExtraction): string {
  const field = (label: string, v: ThreadExtraction["budget"]) => `${label}: ${v ? v.value : "not mentioned"}.`;
  return [x.summary, x.kind === "inquiry" ? `${field("Budget", x.budget)} ${field("Timeline", x.timeline)}` : null]
    .filter(Boolean)
    .join(" ");
}

/** CN-04, LD-01, AN-02: read a thread in full and turn what it says into signals. */
export async function extractThreads(studioId: string, integrationId: string, threadIds: string[]) {
  const conn = db();
  const studio = await repo.getStudio(conn, studioId);
  const gmail = await gmailFor(studioId, integrationId);
  const now = new Date().toISOString();
  const signals: OpportunitySignal[] = [];

  for (const threadId of threadIds) {
    const rows = await repo.threadInteractions(conn, studioId, threadId);
    if (rows.length === 0) continue;
    const known = new Set(rows.map((r) => r.id));

    // Only messages Flossamer classed as business are read; the rest of the thread is ignored.
    const messages = (await gmail.thread(threadId)).filter((m) => known.has(m.id));
    if (messages.length === 0) continue;

    let x: ThreadExtraction;
    try {
      x = await extractThread(
        messages.map((m) => ({
          from: m.headers.from,
          at: m.headers.date,
          direction: m.headers.labels.includes("SENT") ? "outbound" : "inbound",
          body: m.body.slice(0, 6000),
        })),
        repo.studioContext(studio),
      );
    } catch {
      continue; // One bad thread shouldn't stop the batch; it's retried on the next sync.
    }

    const last = rows.at(-1)!;
    await repo.setExtraction(conn, studioId, last.id, x);

    const firstInbound = rows.find((r) => r.direction === "inbound");
    const recent = firstInbound && Date.parse(now) - Date.parse(firstInbound.at) < INQUIRY_WINDOW_DAYS * 86_400_000;

    if ((x.kind === "inquiry" || x.kind === "intro") && firstInbound && recent && x.confidence >= 0.6) {
      signals.push({
        id: `${x.kind}:${threadId}`,
        type: x.kind,
        comingUpKind: null,
        personId: firstInbound.personId,
        evidence: [firstInbound.id],
        reason: describe(x),
        confidence: x.confidence,
        windowOpens: null,
        reachOutBy: null,
        status: "open",
        createdAt: now,
      });
      if (x.kind === "inquiry" && firstInbound.personId) {
        await repo.suggestRelationship(conn, studioId, firstInbound.personId, "prospect", firstInbound.id, 0.6);
      }
    }

    const revisit = x.deferredIntent?.revisitAround;
    if (x.deferredIntent && revisit && Date.parse(revisit) > Date.parse(now)) {
      const reachOutBy = addDays(new Date(revisit).toISOString(), -14);
      signals.push({
        id: `coming_up:deferred:${threadId}`,
        type: "coming_up",
        comingUpKind: "deferred_intent",
        personId: last.personId,
        evidence: [last.id],
        reason: `They said: "${x.deferredIntent.quote}"`,
        confidence: 0.7,
        windowOpens: isoDay(new Date(revisit).toISOString()),
        reachOutBy: isoDay(reachOutBy < now ? now : reachOutBy),
        status: "open",
        createdAt: now,
      });
    }
  }

  await repo.upsertSignals(conn, studioId, signals);
}

/** VC-01: learn the user's voice from recent business mail they sent. */
export async function learnStudioVoice(studioId: string, integrationId: string) {
  const conn = db();
  const studio = await repo.getStudio(conn, studioId);
  if (studio.voice) return;
  const ids = await repo.recentOutboundIds(conn, studioId, 25);
  if (ids.length < 5) return; // Not enough to learn from yet.
  const gmail = await gmailFor(studioId, integrationId);
  const bodies: string[] = [];
  for (const id of ids) bodies.push((await gmail.body(id)).slice(0, 3000));
  const voice = await learnVoice(bodies.filter((b) => b.length > 40));
  await repo.updateStudio(conn, studioId, { voice });
}

/** Types the detectors own. Inquiries and deferred intent come from extraction, trends and ideas from the radar. */
const DETECTOR_OWNED = new Set(["stalled", "waiting", "reconnect"]);
/** Coming up kinds produced by the detectors; deferred intent comes from extraction, trends from the radar. */
const DETECTOR_KINDS = new Set(["repeat_client_cycle", "job_change", "slow_season"]);
const isDetectorOwned = (s: OpportunitySignal) =>
  DETECTOR_OWNED.has(s.type) || (s.type === "coming_up" && s.comingUpKind !== null && DETECTOR_KINDS.has(s.comingUpKind));

/** Re-run every deterministic detector and reconcile with what's stored. */
export async function recomputeSignals(studioId: string) {
  const conn = db();
  const now = new Date().toISOString();
  const [people, interactions, projects, stored, skipWaiting] = await Promise.all([
    repo.listPeople(conn, studioId),
    repo.listInteractions(conn, studioId),
    repo.listProjects(conn, studioId),
    repo.listSignals(conn, studioId),
    repo.threadsNotNeedingReply(conn, studioId),
  ]);

  // Don't flag threads as waiting when extraction found nothing to answer.
  const fresh = detectAll({ now, people, interactions, projects }).filter(
    (s) => !(s.type === "waiting" && skipWaiting.has(s.id.slice("waiting:".length))),
  );
  await repo.upsertSignals(conn, studioId, fresh);

  // Close detector signals that no longer apply (the thread got a reply, the person got in touch).
  const freshIds = new Set(fresh.map((s) => s.id));
  for (const s of stored) {
    if (s.status === "open" && isDetectorOwned(s) && !freshIds.has(s.id)) {
      await repo.setSignalStatus(conn, studioId, s.id, "done");
    }
  }

  await repo.reopenExpiredSnoozes(conn, studioId, isoDay(now));
}
