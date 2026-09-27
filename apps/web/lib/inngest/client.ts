import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "flossamer" });

/** Event names, kept in one place so senders and triggers can't drift. */
export const EVENTS = {
  backfillRequested: "gmail/backfill.requested",
  syncRequested: "gmail/sync.requested",
  voiceRequested: "studio/voice.requested",
  signalsRecompute: "studio/signals.recompute",
} as const;

export interface IntegrationEventData {
  studioId: string;
  integrationId: string;
}
