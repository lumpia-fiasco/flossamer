import { classifyMessage, extractThread, learnVoice, type ThreadExtraction } from "@flossamer/agents";
import { addDays, counterpartOf, detectAll, isoDay, type OpportunitySignal } from "@flossamer/core";
import { GmailSource, processPage, type SourceHeaders } from "@flossamer/mail";
import { decrypt } from "@/lib/crypto";
import { required } from "@/lib/env";
import * as repo from "@/lib/repo";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ingestion steps run by background jobs. Each function is one retryable unit
 * of work and is idempotent: re-running it after a failure changes nothing that
 * already succeeded.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Threads active within this window get read in full and extracted. */
const EXTRACT_WINDOW_DAYS = 120;
/** New inquiries older than this aren't "new" any more. */
const INQUIRY_WINDOW_DAYS = 30;

export async function gmailFor(db: Admin, integrationId: string): Promise<GmailSource> {
  const { data, error } = await db
    .from("integration_secrets")
    .select("refresh_token_encrypted")
    .eq("integration_id", integrationId)
    .single();
  if (error) throw new Error(`No stored Gmail token: ${error.message}`);
  return new GmailSource({
    refreshToken: decrypt(data.refresh_token_encrypted),
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
  });
}

export async function markIntegration(
  db: Admin,
  integrationId: string,
  patch: { sync_state?: string; sync_error?: string | null; last_synced_at?: string; checkpoint?: unknown },
) {
  const { error } = await db.from("integrations").update(patch).eq("id", integrationId);
  if (error) throw new Error(error.message);
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
  const db = createAdminClient();
  const studio = await repo.getStudio(db, opts.studioId);
  const gmail = await gmailFor(db, opts.integrationId);
  const filter = await repo.filterContext(db, studio);
  const newThreadIds = new Set<string>();

  const result = await processPage({
    source: gmail,
    filter,
    after: opts.after,
    pageToken: opts.pageToken,
    store: {
      hasSeen: (id) => repo.hasSeen(db, studio.id, id),
      markSeen: (id, mailClass) => repo.markSeen(db, studio.id, id, mailClass),
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
        const personId = await repo.resolvePerson(db, studio.id, rawCounterpart);
        await repo.insertInteraction(db, studio.id, {
          id: ref.id,
          thread_id: h.threadId,
          at: h.date,
          direction: sent ? "outbound" : "inbound",
          counterpart: counterpartOf(h),
          counterpartName: rawCounterpart.includes("<") ? rawCounterpart.split("<")[0]!.replace(/"/g, "").trim() : null,
          personId,
          subject: h.subject,
          summary: summarize(h),
          expects_reply: sent && repo.expectsReply(body),
        });
        newThreadIds.add(h.threadId);
      },
    },
  });

  return { ...result, newThreadIds: [...newThreadIds] };
}

/** Threads with recent activity, oldest-first, for extraction. */
export async function recentThreadIds(studioId: string): Promise<string[]> {
  const db = createAdminClient();
  const since = addDays(new Date().toISOString(), -EXTRACT_WINDOW_DAYS);
  const { data, error } = await db
    .from("interactions")
    .select("thread_id, at")
    .eq("studio_id", studioId)
    .gte("at", since)
    .order("at", { ascending: false });
  if (error) throw new Error(error.message);
  return [...new Set(data.map((r) => r.thread_id as string))];
}

function describe(x: ThreadExtraction): string {
  const field = (label: string, v: ThreadExtraction["budget"]) => `${label}: ${v ? v.value : "not mentioned"}.`;
  return [x.summary, x.kind === "inquiry" ? [field("Budget", x.budget), field("Timeline", x.timeline)].join(" ") : null]
    .filter(Boolean)
    .join(" ");
}

/** CN-04, LD-01, AN-02: read a thread in full and turn what it says into signals. */
export async function extractThreads(studioId: string, integrationId: string, threadIds: string[]) {
  const db = createAdminClient();
  const studio = await repo.getStudio(db, studioId);
  const gmail = await gmailFor(db, integrationId);
  const now = new Date().toISOString();
  const signals: OpportunitySignal[] = [];

  for (const threadId of threadIds) {
    const { data: rows } = await db
      .from("interactions")
      .select("id, person_id, direction, at")
      .eq("studio_id", studioId)
      .eq("thread_id", threadId)
      .order("at");
    if (!rows?.length) continue;
    const known = new Set(rows.map((r) => r.id as string));

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
    await db.from("interactions").update({ extraction: x }).eq("studio_id", studioId).eq("id", last.id);

    const firstInbound = rows.find((r) => r.direction === "inbound");
    const recent = Date.parse(now) - Date.parse(firstInbound?.at ?? last.at) < INQUIRY_WINDOW_DAYS * 86_400_000;

    if ((x.kind === "inquiry" || x.kind === "intro") && firstInbound && recent && x.confidence >= 0.6) {
      signals.push({
        id: `${x.kind}:${threadId}`,
        type: x.kind,
        comingUpKind: null,
        personId: firstInbound.person_id,
        evidence: [firstInbound.id],
        reason: describe(x),
        confidence: x.confidence,
        windowOpens: null,
        reachOutBy: null,
        status: "open",
        createdAt: now,
      });
      if (x.kind === "inquiry" && firstInbound.person_id) {
        const { data: person } = await db.from("people").select("relationship").eq("id", firstInbound.person_id).single();
        if (person?.relationship?.provenance?.method !== "user_entered") {
          await db
            .from("people")
            .update({ relationship: { value: "prospect", provenance: { source: firstInbound.id, method: "inferred", confidence: 0.6 } } })
            .eq("id", firstInbound.person_id);
        }
      }
    }

    const revisit = x.deferredIntent?.revisitAround;
    if (x.deferredIntent && revisit && Date.parse(revisit) > Date.parse(now)) {
      const reachOutBy = addDays(new Date(revisit).toISOString(), -14);
      signals.push({
        id: `coming_up:deferred:${threadId}`,
        type: "coming_up",
        comingUpKind: "deferred_intent",
        personId: last.person_id,
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

  await repo.upsertSignals(db, studioId, signals);
}

/** VC-01: learn the user's voice from recent business mail they sent. */
export async function learnStudioVoice(studioId: string, integrationId: string) {
  const db = createAdminClient();
  const studio = await repo.getStudio(db, studioId);
  if (studio.voice) return;
  const { data } = await db
    .from("interactions")
    .select("id")
    .eq("studio_id", studioId)
    .eq("direction", "outbound")
    .order("at", { ascending: false })
    .limit(25);
  if (!data || data.length < 5) return; // Not enough to learn from yet.
  const gmail = await gmailFor(db, integrationId);
  const bodies: string[] = [];
  for (const { id } of data) bodies.push((await gmail.body(id)).slice(0, 3000));
  const voice = await learnVoice(bodies.filter((b) => b.length > 40));
  await db.from("studios").update({ voice }).eq("id", studioId);
}

/** Types the detectors own. Anything else (inquiries, deferred intent) comes from extraction. */
const DETECTOR_OWNED = new Set(["stalled", "waiting", "reconnect"]);
const isDetectorOwned = (s: OpportunitySignal) =>
  DETECTOR_OWNED.has(s.type) || (s.type === "coming_up" && s.comingUpKind !== "deferred_intent");

/** Re-run every deterministic detector and reconcile with what's stored. */
export async function recomputeSignals(studioId: string) {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const [people, interactions, projects, stored] = await Promise.all([
    repo.listPeople(db, studioId),
    repo.listInteractions(db, studioId),
    repo.listProjects(db, studioId),
    repo.listSignals(db, studioId),
  ]);

  // Don't flag threads as waiting when extraction found nothing to answer.
  const { data: noReplyNeeded } = await db
    .from("interactions")
    .select("thread_id")
    .eq("studio_id", studioId)
    .eq("extraction->>needsReplyFromUser", "false");
  const skipWaiting = new Set((noReplyNeeded ?? []).map((r) => r.thread_id as string));

  const fresh = detectAll({ now, people, interactions, projects }).filter(
    (s) => !(s.type === "waiting" && skipWaiting.has(s.id.slice("waiting:".length))),
  );
  await repo.upsertSignals(db, studioId, fresh);

  // Close detector signals that no longer apply (the thread got a reply, the person got in touch).
  const freshIds = new Set(fresh.map((s) => s.id));
  for (const s of stored) {
    if (s.status === "open" && isDetectorOwned(s) && !freshIds.has(s.id)) {
      await repo.setSignalStatus(db, studioId, s.id, "done");
    }
  }

  // Snoozes that have run out come back.
  await db
    .from("signals")
    .update({ status: "open", snoozed_until: null })
    .eq("studio_id", studioId)
    .eq("status", "snoozed")
    .lte("snoozed_until", isoDay(now));
}
