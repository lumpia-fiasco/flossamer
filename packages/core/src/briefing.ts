import { isoDay } from "./dates";
import type { OpportunitySignal } from "./types";

/**
 * This week (TD-01 to TD-05). Principle 6, "quiet is a feature": the briefing
 * never pads itself. Empty sections stay empty and `isQuiet` says so.
 */

export const MAX_RECONNECTS = 3;
export const MAX_COMING_UP = 3;

export interface Briefing {
  weekOf: string;
  newConversations: OpportunitySignal[];
  waitingOnYou: OpportunitySignal[];
  followUps: OpportunitySignal[];
  reconnects: OpportunitySignal[];
  comingUp: OpportunitySignal[];
  isQuiet: boolean;
}

const byConfidence = (a: OpportunitySignal, b: OpportunitySignal) => b.confidence - a.confidence;
const byOldestEvidence = (a: OpportunitySignal, b: OpportunitySignal) => a.createdAt.localeCompare(b.createdAt);

export function composeBriefing(signals: OpportunitySignal[], now: string): Briefing {
  const open = signals.filter((s) => s.status === "open");
  const of = (...types: OpportunitySignal["type"][]) => open.filter((s) => types.includes(s.type));

  const comingUp = of("coming_up")
    .sort((a, b) => (a.reachOutBy ?? "").localeCompare(b.reachOutBy ?? ""))
    .slice(0, MAX_COMING_UP);
  // A person with a timed reason to reach out shouldn't also get a generic reconnect.
  const timed = new Set(comingUp.map((s) => s.personId).filter(Boolean));
  // An inquiry card already covers the reply, so don't list its thread as waiting too.
  const inquiryEvidence = new Set(of("inquiry", "intro").flatMap((s) => s.evidence));

  const briefing: Omit<Briefing, "isQuiet"> = {
    weekOf: isoDay(now),
    newConversations: of("inquiry", "intro").sort(byConfidence),
    waitingOnYou: of("waiting")
      .filter((s) => !s.evidence.some((e) => inquiryEvidence.has(e)))
      .sort(byOldestEvidence),
    followUps: of("stalled").sort(byOldestEvidence),
    reconnects: of("reconnect")
      .filter((s) => !timed.has(s.personId))
      .sort(byConfidence)
      .slice(0, MAX_RECONNECTS),
    comingUp,
  };

  const total = Object.values(briefing).filter(Array.isArray).reduce((n, list) => n + list.length, 0);
  return { ...briefing, isQuiet: total === 0 };
}
