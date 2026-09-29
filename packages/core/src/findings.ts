import { daysBetween } from "./dates";
import type { Interaction, OpportunitySignal, Person, Project } from "./types";

/**
 * Gate 0 findings report (PRD sections 12 and 14): a one-page summary of what
 * the backfill found, used for the concierge test and at the end of the trial.
 * Unlike the weekly briefing it covers the whole history, so sections hold more.
 */

export const REPORT_ITEMS_PER_SECTION = 5;

export interface Finding {
  signalId: string;
  personId: string | null;
  personName: string | null;
  reason: string;
  lastContact: string | null;
  reachOutBy: string | null;
  confidence: number;
}

export interface FindingsSection {
  key: "waiting" | "follow_up" | "new" | "coming_up" | "reconnect";
  title: string;
  note: string;
  items: Finding[];
  /** Items beyond the section cap. */
  more: number;
}

export interface FindingsReport {
  generatedAt: string;
  periodStart: string | null;
  totals: {
    businessMessages: number;
    conversations: number;
    people: number;
    clients: number;
    paidProjects: number;
    setAsidePersonal: number;
    setAsideAutomated: number;
  };
  sections: FindingsSection[];
  /** The single best reason to write to someone today, shown once at the top of the page. */
  topPick: Finding | null;
}

export interface MailCounts {
  business: number;
  personal: number;
  automated: number;
}

const SECTIONS: { key: FindingsSection["key"]; types: OpportunitySignal["type"][]; title: string; note: string }[] = [
  { key: "waiting", types: ["waiting"], title: "Waiting on you", note: "People who wrote and haven't heard back." },
  { key: "new", types: ["inquiry", "intro"], title: "New conversations", note: "Inquiries and introductions from the last month." },
  { key: "follow_up", types: ["stalled"], title: "Gone quiet after you wrote", note: "Proposals and questions that never got a reply." },
  { key: "coming_up", types: ["coming_up"], title: "Coming up", note: "Moments to get in touch before they arrive." },
  { key: "reconnect", types: ["reconnect"], title: "Relationships worth a note", note: "Past clients and collaborators you haven't heard from in a while." },
];

const CLIENT_TYPES = new Set(["client", "past_client"]);

/**
 * Higher is a better reason to write today: an unanswered inquiry is money on
 * the table, then introductions, then timed moments, then everything else.
 */
function priority(s: OpportunitySignal): number {
  const base: Record<OpportunitySignal["type"], number> = { inquiry: 5, intro: 4.5, coming_up: 4, waiting: 3.5, stalled: 3, reconnect: 2, idea: 1 };
  return base[s.type] + s.confidence;
}

export function composeFindings(input: {
  now: string;
  people: Person[];
  interactions: Interaction[];
  projects: Project[];
  signals: OpportunitySignal[];
  mail: MailCounts;
}): FindingsReport {
  const { now, people, interactions, projects, signals, mail } = input;
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const lastContact = new Map<string, string>();
  for (const i of interactions) {
    if (!i.personId) continue;
    const prev = lastContact.get(i.personId);
    if (!prev || i.at > prev) lastContact.set(i.personId, i.at);
  }

  // Only what's still open, and only people the user hasn't ruled out.
  const open = signals.filter((s) => s.status === "open");
  const toFinding = (s: OpportunitySignal): Finding => ({
    signalId: s.id,
    personId: s.personId,
    personName: s.personId ? (peopleById.get(s.personId)?.name ?? null) : null,
    reason: s.reason,
    lastContact: s.personId ? (lastContact.get(s.personId) ?? null) : null,
    reachOutBy: s.reachOutBy,
    confidence: s.confidence,
  });

  // A person with a timed reason shouldn't also appear as a generic reconnect,
  // and an inquiry card already covers replying, so its thread isn't "waiting" too.
  const timed = new Set(open.filter((s) => s.type === "coming_up" && s.personId).map((s) => s.personId));
  const inquiryEvidence = new Set(open.filter((s) => s.type === "inquiry" || s.type === "intro").flatMap((s) => s.evidence));
  const topSignal = open
    .filter((s) => s.personId && (s.type !== "reconnect" || !timed.has(s.personId)))
    .sort((a, b) => priority(b) - priority(a))[0];

  const sections = SECTIONS.map(({ key, types, title, note }) => {
    let matching = open.filter((s) => types.includes(s.type) && s.id !== topSignal?.id);
    if (key === "reconnect") matching = matching.filter((s) => !timed.has(s.personId));
    if (key === "waiting") matching = matching.filter((s) => !s.evidence.some((e) => inquiryEvidence.has(e)));
    matching.sort((a, b) =>
      key === "coming_up"
        ? (a.reachOutBy ?? "").localeCompare(b.reachOutBy ?? "")
        : key === "reconnect"
          ? // Longest-quiet first: the relationships most at risk.
            (lastContact.get(a.personId ?? "") ?? "").localeCompare(lastContact.get(b.personId ?? "") ?? "")
          : b.confidence - a.confidence,
    );
    return {
      key,
      title,
      note,
      items: matching.slice(0, REPORT_ITEMS_PER_SECTION).map(toFinding),
      more: Math.max(0, matching.length - REPORT_ITEMS_PER_SECTION),
    };
  }).filter((s) => s.items.length > 0);

  const earliest = interactions.reduce<string | null>((min, i) => (!min || i.at < min ? i.at : min), null);

  return {
    generatedAt: now,
    periodStart: earliest,
    totals: {
      businessMessages: mail.business || interactions.length,
      conversations: new Set(interactions.map((i) => i.threadId)).size,
      people: people.length,
      clients: people.filter((p) => CLIENT_TYPES.has(p.relationship.value)).length,
      paidProjects: projects.filter((p) => p.paidAmount !== null).length,
      setAsidePersonal: mail.personal,
      setAsideAutomated: mail.automated,
    },
    sections,
    topPick: topSignal ? toFinding(topSignal) : null,
  };
}

/** Gate 0: did the designer act on the report within a week of first opening it? */
export function gateZeroOutcome(input: {
  firstViewedAt: string | null;
  actionsAt: string[];
  now: string;
}): { status: "not_viewed" | "acted" | "waiting" | "no_action"; actedAt: string | null; daysLeft: number | null } {
  const { firstViewedAt, actionsAt, now } = input;
  if (!firstViewedAt) return { status: "not_viewed", actedAt: null, daysLeft: null };
  const acted = actionsAt
    .filter((at) => at >= firstViewedAt && daysBetween(firstViewedAt, at) <= 7)
    .sort()[0];
  if (acted) return { status: "acted", actedAt: acted, daysLeft: null };
  const elapsed = daysBetween(firstViewedAt, now);
  return elapsed <= 7
    ? { status: "waiting", actedAt: null, daysLeft: Math.ceil(7 - elapsed) }
    : { status: "no_action", actedAt: null, daysLeft: null };
}
