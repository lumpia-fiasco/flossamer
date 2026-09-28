import { daysBetween, median } from "./dates";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
import type { Interaction, OpportunitySignal, Person } from "./types";

/**
 * Deterministic detectors over the user's own business mail
 * (LD-02 stalled, LD-03 waiting, RL-02 quiet relationships).
 * Language-dependent detection (inquiries, intros, deferred intent) lives in
 * @flossamer/agents; everything here is cheap, testable and runs on every sync.
 */

export interface DetectOptions {
  now: string;
  /** Days without a reply before a sent proposal or question counts as stalled. */
  stalledAfterDays?: number;
  /** Hours before an unanswered inbound message counts as waiting. */
  waitingAfterHours?: number;
  /** Older unanswered threads are left to the reconnect detector. */
  waitingWithinDays?: number;
}

const QUIET_TYPES = new Set(["client", "past_client", "referrer", "collaborator"]);

export function makeSignal(
  partial: Omit<OpportunitySignal, "status" | "createdAt" | "comingUpKind" | "windowOpens" | "reachOutBy"> &
    Partial<Pick<OpportunitySignal, "comingUpKind" | "windowOpens" | "reachOutBy">>,
  now: string,
): OpportunitySignal {
  return {
    comingUpKind: null,
    windowOpens: null,
    reachOutBy: null,
    ...partial,
    status: "open",
    createdAt: now,
  };
}

export function groupByThread(interactions: Interaction[]): Map<string, Interaction[]> {
  const threads = new Map<string, Interaction[]>();
  for (const i of interactions) {
    if (i.mailClass !== "business") continue;
    const list = threads.get(i.threadId) ?? [];
    list.push(i);
    threads.set(i.threadId, list);
  }
  for (const list of threads.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  return threads;
}

export function detectThreadSignals(
  interactions: Interaction[],
  { now, stalledAfterDays = 7, waitingAfterHours = 24, waitingWithinDays = 14 }: DetectOptions,
): OpportunitySignal[] {
  const out: OpportunitySignal[] = [];

  for (const [threadId, thread] of groupByThread(interactions)) {
    const last = thread.at(-1)!;
    const idleDays = daysBetween(last.at, now);

    if (last.direction === "outbound" && last.expectsReply && idleDays >= stalledAfterDays) {
      out.push(
        makeSignal(
          {
            id: `stalled:${threadId}`,
            type: "stalled",
            personId: last.personId,
            evidence: [last.id],
            reason: `No reply in ${plural(Math.floor(idleDays), "day")} to your last message.`,
            confidence: 0.9,
          },
          now,
        ),
      );
    }

    if (last.direction === "inbound" && idleDays * 24 >= waitingAfterHours && idleDays <= waitingWithinDays) {
      out.push(
        makeSignal(
          {
            id: `waiting:${threadId}`,
            type: "waiting",
            personId: last.personId,
            evidence: [last.id],
            reason: Math.floor(idleDays) === 0 ? "They wrote today and haven't heard back." : `They wrote ${plural(Math.floor(idleDays), "day")} ago and haven't heard back.`,
            confidence: 0.8,
          },
          now,
        ),
      );
    }
  }

  return out;
}

/**
 * RL-02: a relationship is quiet when the time since last contact is well past
 * that relationship's own rhythm. Starting rule (open question in the PRD):
 * twice the median gap, at least 90 days; 180 days when there's too little history.
 */
export function detectQuietRelationships(
  people: Person[],
  interactions: Interaction[],
  { now }: DetectOptions,
): OpportunitySignal[] {
  const byPerson = new Map<string, Interaction[]>();
  for (const i of interactions) {
    if (i.mailClass !== "business" || !i.personId) continue;
    const list = byPerson.get(i.personId) ?? [];
    list.push(i);
    byPerson.set(i.personId, list);
  }

  const out: OpportunitySignal[] = [];
  for (const person of people) {
    if (!person.confirmed || !QUIET_TYPES.has(person.relationship.value)) continue;
    const history = (byPerson.get(person.id) ?? []).sort((a, b) => a.at.localeCompare(b.at));
    const last = history.at(-1);
    if (!last) continue;

    const gaps = history.slice(1).map((i, n) => daysBetween(history[n]!.at, i.at));
    const typical = history.length >= 3 ? median(gaps) : null;
    const threshold = typical === null ? 180 : Math.max(2 * typical, 90);
    const quietFor = daysBetween(last.at, now);
    if (quietFor < threshold) continue;

    out.push(
      makeSignal(
        {
          id: `reconnect:${person.id}`,
          type: "reconnect",
          personId: person.id,
          evidence: [last.id],
          reason: `Last in touch ${plural(Math.round(quietFor / 30), "month")} ago: ${last.summary}`,
          confidence: typical === null ? 0.6 : 0.75,
        },
        now,
      ),
    );
  }
  return out;
}
