import { z } from "zod";

/**
 * Domain model for Flossamer, following PRD v2.1 section 9.
 * Every value an agent infers is wrapped in `Inferred` so the UI can tell
 * confirmed facts from suggestions (TR-04).
 */

export const Method = z.enum(["extracted", "inferred", "user_entered"]);
export type Method = z.infer<typeof Method>;

export const Provenance = z.object({
  /** Gmail message id (or meeting id) the value came from. */
  source: z.string().nullable(),
  method: Method,
  /** 0–1. User-entered values are always 1. */
  confidence: z.number().min(0).max(1),
});
export type Provenance = z.infer<typeof Provenance>;

export const inferred = <T extends z.ZodType>(value: T) =>
  z.object({ value, provenance: Provenance });

export type Inferred<T> = { value: T; provenance: Provenance };

export const RelationshipType = z.enum([
  "client",
  "past_client",
  "prospect",
  "referrer",
  "collaborator",
  "other",
]);
export type RelationshipType = z.infer<typeof RelationshipType>;

export const Person = z.object({
  id: z.string(),
  name: z.string(),
  emails: z.array(z.string()),
  organizationIds: z.array(z.string()),
  relationship: inferred(RelationshipType),
  /** Set only when an email makes the introduction explicit (RL-03). */
  referredById: z.string().nullable(),
  confirmed: z.boolean(),
});
export type Person = z.infer<typeof Person>;

export const Organization = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
  industry: inferred(z.string()).nullable(),
});
export type Organization = z.infer<typeof Organization>;

export const MailClass = z.enum(["business", "personal", "automated", "undecided"]);
export type MailClass = z.infer<typeof MailClass>;

/**
 * One email. Stores a reference and a short summary, never the full body
 * (PRD section 10: minimize third-party data).
 */
export const Interaction = z.object({
  id: z.string(),
  threadId: z.string(),
  at: z.string().datetime(),
  direction: z.enum(["inbound", "outbound"]),
  /** Counterpart email address (the non-user side). */
  counterpart: z.string(),
  personId: z.string().nullable(),
  /** Signature block or display name, used for job-change detection. */
  counterpartSignature: z.string().nullable(),
  summary: z.string(),
  mailClass: MailClass,
  /** True when the user asked a question or sent a proposal awaiting reply. */
  expectsReply: z.boolean(),
});
export type Interaction = z.infer<typeof Interaction>;

export const SignalType = z.enum([
  "inquiry",
  "intro",
  "stalled",
  "waiting",
  "reconnect",
  "coming_up",
  /** Industry radar: a trend that matches a service the user offers (IR-06). */
  "idea",
]);
export type SignalType = z.infer<typeof SignalType>;

export const ComingUpKind = z.enum([
  "repeat_client_cycle",
  "deferred_intent",
  "job_change",
  "slow_season",
  "industry_season",
  "company_news",
  /** Industry radar: a trend that affects this client (IR-05). */
  "industry_trend",
]);
export type ComingUpKind = z.infer<typeof ComingUpKind>;

export const SignalStatus = z.enum(["open", "done", "snoozed", "dismissed", "wrong"]);
export type SignalStatus = z.infer<typeof SignalStatus>;

export const OpportunitySignal = z.object({
  id: z.string(),
  type: SignalType,
  comingUpKind: ComingUpKind.nullable(),
  personId: z.string().nullable(),
  /** Interactions that justify this signal. Never empty (TD-04). */
  evidence: z.array(z.string()).min(1),
  /** Plain-language reason shown on the card. */
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  /** Coming up items only: when the window opens and when to reach out by. */
  windowOpens: z.string().nullable(),
  reachOutBy: z.string().nullable(),
  status: SignalStatus,
  createdAt: z.string().datetime(),
  /** The publication a radar item came from. Always shown, always credited. */
  link: z.object({ url: z.string().url(), title: z.string(), source: z.string() }).nullable().optional(),
});
export type OpportunitySignal = z.infer<typeof OpportunitySignal>;

export const ProjectStage = z.string();

export const Project = z.object({
  id: z.string(),
  title: z.string(),
  personIds: z.array(z.string()),
  threadIds: z.array(z.string()),
  /** User-named stage (WK-03). */
  stage: ProjectStage,
  service: z.string().nullable(),
  estimatedValue: z.number().nullable(),
  expectedStart: z.string().nullable(),
  nextStep: z.string().nullable(),
  /** North-star record (WK-11). */
  paidAmount: z.number().nullable(),
  paidAt: z.string().nullable(),
  /** Signal this project grew out of, for attribution. */
  originSignalId: z.string().nullable(),
});
export type Project = z.infer<typeof Project>;

export const DEFAULT_STAGES = [
  "Conversation",
  "Proposal out",
  "Booked",
  "In progress",
  "Wrapped",
] as const;

export const VoiceProfile = z.object({
  tone: z.string(),
  typicalLength: z.enum(["short", "medium", "long"]),
  greetings: z.array(z.string()),
  signOffs: z.array(z.string()),
  avoid: z.array(z.string()),
});
export type VoiceProfile = z.infer<typeof VoiceProfile>;

/** Every agent suggestion and user decision, for the activity log (TR-01). */
export const AgentAction = z.object({
  id: z.string(),
  agent: z.enum(["relationship_keeper", "conversation_reader", "draft_writer"]),
  trigger: z.string(),
  evidence: z.array(z.string()),
  proposed: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1),
  approval: z.enum(["pending", "approved", "rejected", "undone"]),
  at: z.string().datetime(),
});
export type AgentAction = z.infer<typeof AgentAction>;
