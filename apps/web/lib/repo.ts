import {
  CONSUMER_DOMAINS,
  domainOf,
  emailAddress,
  type Exclusions,
  type FilterContext,
  type Interaction,
  type MailClass,
  type OpportunitySignal,
  type Person,
  type Project,
  type RelationshipType,
  type VoiceProfile,
} from "@flossamer/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mapping between Postgres rows and @flossamer/core types. Every function takes
 * a studio id and scopes its queries to it, so the same code is safe with the
 * service-role client (background jobs) and the user client (pages).
 */

type Db = SupabaseClient;

/** Postgres returns "+00:00" offsets; core compares ISO strings, so normalize to "Z". */
const iso = (value: string) => new Date(value).toISOString();
const isoOrNull = (value: string | null) => (value ? iso(value) : null);

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// --- Studio ------------------------------------------------------------------

export interface StudioRow {
  id: string;
  display_name: string | null;
  profile: { services?: string; idealClients?: string; typicalEngagements?: string };
  voice: VoiceProfile | null;
  exclusions: Exclusions;
  backfill_months: number;
  stages: string[];
  onboarded_at: string | null;
}

export async function getStudio(db: Db, studioId: string): Promise<StudioRow> {
  return check(await db.from("studios").select("*").eq("id", studioId).single());
}

export function studioContext(studio: StudioRow): string {
  const p = studio.profile;
  return [
    studio.display_name && `Designer: ${studio.display_name}`,
    p.services && `Services: ${p.services}`,
    p.typicalEngagements && `Typical engagements: ${p.typicalEngagements}`,
    p.idealClients && `Ideal clients: ${p.idealClients}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// --- People ------------------------------------------------------------------

interface PersonRow {
  id: string;
  name: string;
  relationship: Person["relationship"];
  referred_by_id: string | null;
  confirmed: boolean;
  person_emails: { email: string }[];
  person_organizations: { organization_id: string }[];
}

const toPerson = (r: PersonRow): Person => ({
  id: r.id,
  name: r.name,
  emails: r.person_emails.map((e) => e.email),
  organizationIds: r.person_organizations.map((o) => o.organization_id),
  relationship: r.relationship,
  referredById: r.referred_by_id,
  confirmed: r.confirmed,
});

export async function listPeople(db: Db, studioId: string): Promise<Person[]> {
  const rows = check(
    await db
      .from("people")
      .select("id, name, relationship, referred_by_id, confirmed, person_emails(email), person_organizations(organization_id)")
      .eq("studio_id", studioId)
      .order("name"),
  );
  return (rows as PersonRow[]).map(toPerson);
}

const nameFromHeader = (raw: string) => {
  const match = raw.match(/^\s*"?([^"<]+?)"?\s*</);
  return match?.[1]?.trim() || null;
};

const titleCase = (s: string) => s.replace(/(^|[\s._-])(\w)/g, (_, sep: string, c: string) => `${sep === "." || sep === "_" ? " " : sep}${c.toUpperCase()}`);

/**
 * Find the person behind an address, or propose a new unconfirmed one (CN-06).
 * Matching is exact on email only; fuzzy matches are suggestions for the user (CN-05).
 */
export async function resolvePerson(db: Db, studioId: string, rawAddress: string): Promise<string> {
  const email = emailAddress(rawAddress);
  const existing = check(
    await db.from("person_emails").select("person_id").eq("studio_id", studioId).eq("email", email).maybeSingle(),
  ) as { person_id: string } | null;
  if (existing) return existing.person_id;

  const name = nameFromHeader(rawAddress) ?? titleCase(email.split("@")[0] ?? email);
  const relationship: Person["relationship"] = {
    value: "other",
    provenance: { source: null, method: "inferred", confidence: 0.3 },
  };
  const person = check(
    await db.from("people").insert({ studio_id: studioId, name, relationship, confirmed: false }).select("id").single(),
  ) as { id: string };
  check(await db.from("person_emails").insert({ person_id: person.id, studio_id: studioId, email }));

  const domain = domainOf(email);
  if (domain && !CONSUMER_DOMAINS.has(domain)) {
    const org = check(
      await db
        .from("organizations")
        .upsert({ studio_id: studioId, domain, name: titleCase(domain.split(".")[0] ?? domain) }, { onConflict: "studio_id,domain" })
        .select("id")
        .single(),
    ) as { id: string };
    check(await db.from("person_organizations").upsert({ person_id: person.id, organization_id: org.id }));
  }
  return person.id;
}

export async function setRelationship(db: Db, studioId: string, personId: string, value: RelationshipType) {
  const relationship: Person["relationship"] = { value, provenance: { source: null, method: "user_entered", confidence: 1 } };
  check(await db.from("people").update({ relationship, confirmed: true }).eq("studio_id", studioId).eq("id", personId));
}

// --- Interactions --------------------------------------------------------------

interface InteractionRow {
  id: string;
  thread_id: string;
  at: string;
  direction: "inbound" | "outbound";
  counterpart: string;
  person_id: string | null;
  subject: string;
  summary: string;
  expects_reply: boolean;
}

const toInteraction = (r: InteractionRow): Interaction => ({
  id: r.id,
  threadId: r.thread_id,
  at: iso(r.at),
  direction: r.direction,
  counterpart: r.counterpart,
  personId: r.person_id,
  counterpartSignature: null,
  summary: r.summary,
  mailClass: "business",
  expectsReply: r.expects_reply,
});

export async function listInteractions(db: Db, studioId: string): Promise<Interaction[]> {
  const rows: InteractionRow[] = [];
  // Page through: a studio can have thousands of business messages.
  for (let from = 0; ; from += 1000) {
    const page = check(
      await db
        .from("interactions")
        .select("id, thread_id, at, direction, counterpart, person_id, subject, summary, expects_reply")
        .eq("studio_id", studioId)
        .order("at")
        .range(from, from + 999),
    ) as InteractionRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows.map(toInteraction);
}

/** Heuristic for LD-02 until extraction runs: did the user ask something or send a proposal? */
export function expectsReply(body: string): boolean {
  const text = body.slice(0, 2000);
  return /\?/.test(text) || /\b(proposal|estimate|quote|scope|attached|let me know)\b/i.test(text);
}

export async function insertInteraction(
  db: Db,
  studioId: string,
  row: Omit<InteractionRow, "person_id"> & { personId: string; counterpartName: string | null },
) {
  check(
    await db.from("interactions").upsert(
      {
        id: row.id,
        studio_id: studioId,
        thread_id: row.thread_id,
        at: row.at,
        direction: row.direction,
        counterpart: row.counterpart,
        counterpart_name: row.counterpartName,
        person_id: row.personId,
        subject: row.subject,
        summary: row.summary,
        expects_reply: row.expects_reply,
      },
      { onConflict: "studio_id,id", ignoreDuplicates: true },
    ),
  );
}

// --- Ingestion ledger ---------------------------------------------------------

export async function hasSeen(db: Db, studioId: string, id: string) {
  const row = check(await db.from("seen_messages").select("id").eq("studio_id", studioId).eq("id", id).maybeSingle());
  return row !== null;
}

export async function markSeen(db: Db, studioId: string, id: string, mailClass: MailClass) {
  if (mailClass === "undecided") throw new Error("Undecided mail must be classified before it is recorded");
  check(await db.from("seen_messages").upsert({ studio_id: studioId, id, mail_class: mailClass }));
}

export async function filterContext(db: Db, studio: StudioRow): Promise<FilterContext> {
  const people = await listPeople(db, studio.id);
  const outbound = check(
    await db.from("interactions").select("counterpart").eq("studio_id", studio.id).eq("direction", "outbound"),
  ) as { counterpart: string }[];
  return {
    exclusions: studio.exclusions,
    knownBusinessContacts: new Set(people.filter((p) => p.confirmed).flatMap((p) => p.emails)),
    addressesUserWroteTo: new Set(outbound.map((r) => r.counterpart)),
  };
}

// --- Projects -----------------------------------------------------------------

interface ProjectRow {
  id: string;
  title: string;
  stage: string;
  service: string | null;
  estimated_value: number | null;
  expected_start: string | null;
  next_step: string | null;
  paid_amount: number | null;
  paid_at: string | null;
  origin_signal_id: string | null;
  project_people: { person_id: string }[];
  project_threads: { thread_id: string }[];
}

export async function listProjects(db: Db, studioId: string): Promise<Project[]> {
  const rows = check(
    await db
      .from("projects")
      .select("*, project_people(person_id), project_threads(thread_id)")
      .eq("studio_id", studioId),
  ) as ProjectRow[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    stage: r.stage,
    personIds: r.project_people.map((p) => p.person_id),
    threadIds: r.project_threads.map((t) => t.thread_id),
    service: r.service,
    estimatedValue: r.estimated_value === null ? null : Number(r.estimated_value),
    expectedStart: isoOrNull(r.expected_start),
    nextStep: r.next_step,
    paidAmount: r.paid_amount === null ? null : Number(r.paid_amount),
    paidAt: r.paid_at,
    originSignalId: r.origin_signal_id,
  }));
}

// --- Signals ------------------------------------------------------------------

interface SignalRow {
  id: string;
  type: OpportunitySignal["type"];
  coming_up_kind: OpportunitySignal["comingUpKind"];
  person_id: string | null;
  evidence: string[];
  reason: string;
  confidence: number;
  window_opens: string | null;
  reach_out_by: string | null;
  status: OpportunitySignal["status"];
  created_at: string;
}

export const toSignal = (r: SignalRow): OpportunitySignal => ({
  id: r.id,
  type: r.type,
  comingUpKind: r.coming_up_kind,
  personId: r.person_id,
  evidence: r.evidence,
  reason: r.reason,
  confidence: r.confidence,
  windowOpens: r.window_opens,
  reachOutBy: r.reach_out_by,
  status: r.status,
  createdAt: iso(r.created_at),
});

export async function listSignals(db: Db, studioId: string): Promise<OpportunitySignal[]> {
  const rows = check(await db.from("signals").select("*").eq("studio_id", studioId)) as SignalRow[];
  return rows.map(toSignal);
}

const signalRow = (studioId: string, s: OpportunitySignal) => ({
  studio_id: studioId,
  id: s.id,
  type: s.type,
  coming_up_kind: s.comingUpKind,
  person_id: s.personId,
  evidence: s.evidence,
  reason: s.reason,
  confidence: s.confidence,
  window_opens: s.windowOpens,
  reach_out_by: s.reachOutBy,
});

/** Insert or refresh signals. Status is never overwritten: the user's decisions stick. */
export async function upsertSignals(db: Db, studioId: string, signals: OpportunitySignal[]) {
  if (signals.length === 0) return;
  check(await db.from("signals").upsert(signals.map((s) => signalRow(studioId, s)), { onConflict: "studio_id,id" }));
}

export async function setSignalStatus(
  db: Db,
  studioId: string,
  signalId: string,
  status: OpportunitySignal["status"],
  extra: { snoozed_until?: string | null; wrong_reason?: string | null } = {},
) {
  check(await db.from("signals").update({ status, ...extra }).eq("studio_id", studioId).eq("id", signalId));
}

// --- Activity log (TR-01) -------------------------------------------------------

export async function logAction(
  db: Db,
  studioId: string,
  action: {
    agent: "relationship_keeper" | "conversation_reader" | "draft_writer" | "user";
    trigger: string;
    evidence?: string[];
    proposed: Record<string, unknown>;
    confidence?: number | null;
    approval: "pending" | "approved" | "rejected" | "undone";
  },
) {
  check(await db.from("agent_actions").insert({ studio_id: studioId, evidence: [], ...action }));
}
