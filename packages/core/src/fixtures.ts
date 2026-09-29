import type { Interaction, OpportunitySignal, Person, Project } from "./types";

/**
 * A sample studio for development and tests: an independent UX designer on
 * 2026-09-27. Each detector has something real to find here.
 */

export const SAMPLE_NOW = "2026-09-27T09:00:00.000Z";

const user = (id: string, name: string, emails: string[], relationship: Person["relationship"]["value"], extra: Partial<Person> = {}): Person => ({
  id,
  name,
  emails,
  organizationIds: [],
  relationship: { value: relationship, provenance: { source: null, method: "user_entered", confidence: 1 } },
  referredById: null,
  confirmed: true,
  ...extra,
});

export const samplePeople: Person[] = [
  user("maya", "Maya Chen", ["maya@northwind.com"], "client"),
  user("jordan", "Jordan Blake", ["jordan@lumen.io", "jordan@atlas.co"], "past_client"),
  user("priya", "Priya Raman", ["priya@fieldnote.app"], "prospect"),
  user("sam", "Sam Okafor", ["sam@kiln.studio"], "prospect", { referredById: "tom" }),
  user("elena", "Elena Ruiz", ["elena@harbor.health"], "past_client"),
  user("tom", "Tom Alvarez", ["tom@alvarez.design"], "referrer"),
];

let seq = 0;
const mail = (
  at: string,
  threadId: string,
  direction: Interaction["direction"],
  counterpart: string,
  personId: string | null,
  summary: string,
  expectsReply = false,
): Interaction => ({
  id: `m${++seq}`,
  threadId,
  at: `${at}T15:00:00.000Z`,
  direction,
  counterpart,
  personId,
  counterpartSignature: null,
  summary,
  mailClass: "business",
  expectsReply,
});

const named: Interaction[] = [
  // Maya: hired the user each November (repeat-client cycle).
  mail("2024-11-04", "t-maya-24", "inbound", "maya@northwind.com", "maya", "Asked for help redesigning checkout before the holiday freeze."),
  mail("2024-11-05", "t-maya-24", "outbound", "maya@northwind.com", "maya", "Sent a scope and timeline for checkout work."),
  mail("2025-11-10", "t-maya-25", "inbound", "maya@northwind.com", "maya", "Asked for a round two on checkout and the account area."),
  mail("2025-11-11", "t-maya-25", "outbound", "maya@northwind.com", "maya", "Confirmed availability from Nov 17."),
  mail("2025-12-15", "t-maya-25b", "inbound", "maya@northwind.com", "maya", "Thanks for the handoff. Let's talk again next year."),

  // Jordan: past client who just moved from Lumen to Atlas (job change).
  mail("2025-03-02", "t-jordan-1", "inbound", "jordan@lumen.io", "jordan", "Wrapped the onboarding redesign, shared results."),
  mail("2025-03-03", "t-jordan-1", "outbound", "jordan@lumen.io", "jordan", "Thanked Jordan, asked to stay in touch."),
  mail("2026-09-06", "t-jordan-2", "inbound", "jordan@atlas.co", "jordan", "Started as VP Product at Atlas, saying hello."),
  mail("2026-09-07", "t-jordan-2", "outbound", "jordan@atlas.co", "jordan", "Congratulated Jordan on the new role."),

  // Priya: proposal sent, no reply (stalled).
  mail("2026-09-08", "t-priya", "inbound", "priya@fieldnote.app", "priya", "Asked for a proposal for a research sprint, budget around $15k."),
  mail("2026-09-12", "t-priya", "outbound", "priya@fieldnote.app", "priya", "Sent the research sprint proposal.", true),

  // Sam: referred by Tom, waiting on the user.
  mail("2026-09-24", "t-tom-intro", "inbound", "tom@alvarez.design", "tom", "Introduced Sam Okafor from Kiln, who needs a design system."),
  mail("2026-09-25", "t-sam", "inbound", "sam@kiln.studio", "sam", "Asked about availability for a design system project in November."),

  // Elena: past client, quiet since January (reconnect).
  mail("2025-06-10", "t-elena", "outbound", "elena@harbor.health", "elena", "Delivered the patient intake prototype."),
  mail("2026-01-20", "t-elena-2", "inbound", "elena@harbor.health", "elena", "Shared that the intake flow cut drop-off. Thanks again."),
];

/**
 * Background volume for 2024–2025: two new inquiries a month, answered,
 * except December, which is quiet both years (slow season).
 */
const background: Interaction[] = ["2024", "2025"].flatMap((year) =>
  Array.from({ length: 11 }, (_, k) => String(k + 1).padStart(2, "0")).flatMap((mm) =>
    ["08", "20"].flatMap((dd) => {
      const thread = `t-bg-${year}${mm}${dd}`;
      const who = `lead-${year}${mm}${dd}@example.com`;
      const replyDay = String(Number(dd) + 1).padStart(2, "0");
      return [
        mail(`${year}-${mm}-${dd}`, thread, "inbound", who, null, "New project inquiry."),
        mail(`${year}-${mm}-${replyDay}`, thread, "outbound", who, null, "Replied to the inquiry."),
      ];
    }),
  ),
);

export const sampleInteractions: Interaction[] = [...named, ...background];

const project = (p: Partial<Project> & Pick<Project, "id" | "title" | "stage">): Project => ({
  personIds: [],
  threadIds: [],
  service: null,
  estimatedValue: null,
  expectedStart: null,
  nextStep: null,
  paidAmount: null,
  paidAt: null,
  originSignalId: null,
  ...p,
});

export const sampleProjects: Project[] = [
  project({ id: "p1", title: "Northwind checkout", stage: "Wrapped", personIds: ["maya"], threadIds: ["t-maya-24"], service: "UX redesign", estimatedValue: 18000, expectedStart: "2024-11-18T00:00:00.000Z", paidAmount: 18000, paidAt: "2025-01-10" }),
  project({ id: "p2", title: "Northwind checkout, round two", stage: "Wrapped", personIds: ["maya"], threadIds: ["t-maya-25"], service: "UX redesign", estimatedValue: 22000, expectedStart: "2025-11-17T00:00:00.000Z", paidAmount: 22000, paidAt: "2026-01-30" }),
  project({ id: "p3", title: "Fieldnote research sprint", stage: "Proposal out", personIds: ["priya"], threadIds: ["t-priya"], service: "Research sprint", estimatedValue: 15000, nextStep: "Follow up on proposal" }),
  project({ id: "p4", title: "Kiln design system", stage: "Conversation", personIds: ["sam"], threadIds: ["t-sam"], service: "Design system", nextStep: "Reply with availability" }),
];

/** What the Conversation reader (LLM) would add on top of the deterministic detectors. */
export const sampleAgentSignals: OpportunitySignal[] = [
  {
    id: "inquiry:t-sam",
    type: "inquiry",
    comingUpKind: null,
    personId: "sam",
    evidence: [named.find((i) => i.threadId === "t-sam")!.id],
    reason: "New design system inquiry, referred by Tom Alvarez. Timeline: November. Budget: not mentioned.",
    confidence: 0.92,
    windowOpens: null,
    reachOutBy: null,
    status: "open",
    createdAt: SAMPLE_NOW,
  },
];

/** What the industry radar would add: one trend matched to a client, one idea. Sample content, not real news. */
export const sampleRadarSignals: OpportunitySignal[] = [
  {
    id: "coming_up:trend:sample-1:elena",
    type: "coming_up",
    comingUpKind: "industry_trend",
    personId: "elena",
    evidence: ["article:sample-1"],
    reason:
      "Health providers are simplifying patient intake after new research on form drop-off. Elena's team shipped an intake flow with you that cut drop-off, so it's a natural reason to check in.",
    confidence: 0.72,
    windowOpens: null,
    reachOutBy: "2026-10-08",
    status: "open",
    createdAt: SAMPLE_NOW,
    link: { url: "https://example.com/sample-intake-research", title: "Why patients abandon intake forms (sample)", source: "Sample publication" },
  },
  {
    id: "idea:sample-2",
    type: "idea",
    comingUpKind: null,
    personId: null,
    evidence: ["article:sample-2"],
    reason:
      "Product teams are adding AI features to design systems faster than they document them. You offer design systems: a short post on keeping AI components consistent could draw inquiries.",
    confidence: 0.66,
    windowOpens: null,
    reachOutBy: null,
    status: "open",
    createdAt: SAMPLE_NOW,
    link: { url: "https://example.com/sample-ai-design-systems", title: "Design systems in the age of AI features (sample)", source: "Sample publication" },
  },
];
