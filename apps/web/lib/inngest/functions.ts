import { addDays } from "@flossamer/core";
import { GmailAuthError } from "@flossamer/mail";
import { NonRetriableError } from "inngest";
import * as repo from "@flossamer/db";
import { db } from "@/lib/db";
import * as ingest from "@/lib/ingest";
import { runRadar } from "@/lib/radar";
import { EVENTS, inngest, type IntegrationEventData } from "./client";

/** Threads per extraction step: small enough to finish well inside a serverless timeout. */
const EXTRACT_BATCH = 8;

type Step = Parameters<Parameters<typeof inngest.createFunction>[1]>[0]["step"];

/**
 * Page through mail after `after`, one step per page, so a failure resumes at
 * the page that failed. Returns the threads that gained business messages.
 */
async function ingestAll(step: Step, data: IntegrationEventData, after: string, label: string) {
  const threads = new Set<string>();
  let pageToken: string | null = null;
  let processed = 0;
  for (let page = 0; ; page++) {
    const result = await step.run(`${label}-page-${page}`, async () => {
      try {
        return await ingest.ingestPage({ ...data, after, pageToken });
      } catch (e) {
        if (e instanceof GmailAuthError) {
          await repo.markIntegration(db(), data.studioId, data.integrationId, { sync_state: "error", sync_error: "Gmail access was revoked or expired. Sign in again to reconnect." });
          throw new NonRetriableError(e.message);
        }
        throw e;
      }
    });
    result.newThreadIds.forEach((t: string) => threads.add(t));
    processed += result.processed;
    await step.run(`${label}-progress-${page}`, () =>
      repo.markIntegration(db(), data.studioId, data.integrationId, { checkpoint: { processed, page } }),
    );
    if (!result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }
  return [...threads];
}

async function extractInBatches(step: Step, data: IntegrationEventData, threadIds: string[], label: string) {
  for (let i = 0; i < threadIds.length; i += EXTRACT_BATCH) {
    const batch = threadIds.slice(i, i + EXTRACT_BATCH);
    await step.run(`${label}-extract-${i / EXTRACT_BATCH}`, () => ingest.extractThreads(data.studioId, data.integrationId, batch));
  }
}

/** First connection: read the backfill window, then build everything on top of it. */
export const backfill = inngest.createFunction(
  {
    id: "gmail-backfill",
    triggers: [{ event: EVENTS.backfillRequested }],
    concurrency: { key: "event.data.integrationId", limit: 1 },
    retries: 4,
  },
  async ({ event, step }) => {
    const data = event.data as IntegrationEventData;

    const after = await step.run("start", async () => {
      const conn = db();
      await repo.getIntegrationForStudio(conn, data.studioId, data.integrationId); // the ids must belong together
      const studio = await repo.getStudio(conn, data.studioId);
      await repo.markIntegration(conn, data.studioId, data.integrationId, { sync_state: "backfilling", sync_error: null, checkpoint: { processed: 0, page: 0 } });
      return addDays(new Date().toISOString(), -30.4 * studio.backfill_months);
    });

    await ingestAll(step, data, after, "backfill");

    const threadIds = await step.run("list-recent-threads", () => ingest.recentThreadIds(data.studioId));
    await extractInBatches(step, data, threadIds, "backfill");

    await step.run("learn-voice", () => ingest.learnStudioVoice(data.studioId, data.integrationId));
    await step.run("signals", () => ingest.recomputeSignals(data.studioId));
    await step.run("done", () =>
      repo.markIntegration(db(), data.studioId, data.integrationId, { sync_state: "live", last_synced_at: new Date().toISOString() }),
    );
  },
);

/** EM-04: pick up new mail. Runs every few minutes per live integration. */
export const sync = inngest.createFunction(
  {
    id: "gmail-sync",
    triggers: [{ event: EVENTS.syncRequested }],
    concurrency: { key: "event.data.integrationId", limit: 1 },
    retries: 3,
  },
  async ({ event, step }) => {
    const data = event.data as IntegrationEventData;
    const startedAt = await step.run("start", async () => {
      const row = await repo.getIntegrationForStudio(db(), data.studioId, data.integrationId);
      if (row.sync_state !== "live") return null;
      // Overlap by a day: Gmail search is day-granular and the ledger skips anything seen.
      return { now: new Date().toISOString(), after: addDays(row.last_synced_at ?? new Date().toISOString(), -1) };
    });
    if (!startedAt) return { skipped: true };

    const threadIds = await ingestAll(step, data, startedAt.after, "sync");
    await extractInBatches(step, data, threadIds, "sync");
    await step.run("signals", () => ingest.recomputeSignals(data.studioId));
    await step.run("done", () => repo.markIntegration(db(), data.studioId, data.integrationId, { last_synced_at: startedAt.now }));
    return { threads: threadIds.length };
  },
);

/** Fan out a sync for every live integration. */
export const syncAll = inngest.createFunction(
  { id: "gmail-sync-all", triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) => {
    const integrations = await step.run("list", () => repo.listLiveIntegrations(db()));
    if (integrations.length > 0) {
      await step.sendEvent(
        "fan-out",
        integrations.map((i) => ({ name: EVENTS.syncRequested, data: { studioId: i.studio_id, integrationId: i.id } })),
      );
    }
  },
);

/** Daily: reopen expired snoozes and move time-based signals (quiet, coming up) along. */
export const dailySignals = inngest.createFunction(
  { id: "signals-daily", triggers: [{ cron: "0 6 * * *" }] },
  async ({ step }) => {
    const studios = await step.run("list", () => repo.listStudioIds(db()));
    for (const id of studios) await step.run(`signals-${id}`, () => ingest.recomputeSignals(id));
  },
);

/** Industry radar: once a day for every studio with a source switched on, or on request. */
export const radarDaily = inngest.createFunction(
  { id: "radar-daily", triggers: [{ cron: "0 14 * * *" }] },
  async ({ step }) => {
    const studios = await step.run("list", () => repo.studiosForRadar(db()));
    if (studios.length > 0) {
      await step.sendEvent("fan-out", studios.map((studioId) => ({ name: EVENTS.radarRequested, data: { studioId } })));
    }
  },
);

export const radar = inngest.createFunction(
  {
    id: "radar-run",
    triggers: [{ event: EVENTS.radarRequested }],
    concurrency: { key: "event.data.studioId", limit: 1 },
    // A manual "check now" shortly after the daily run shouldn't read everything twice.
    debounce: { key: "event.data.studioId", period: "2m" },
    retries: 2,
  },
  async ({ event, step }) => {
    const { studioId } = event.data as { studioId: string };
    return step.run("radar", () => runRadar(studioId));
  },
);

export const functions = [backfill, sync, syncAll, dailySignals, radarDaily, radar];
