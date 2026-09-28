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
import type { Db } from "./client";

/**
 * Every query Flossamer runs. Isolation rule: every statement is scoped to a
 * studio id, either directly (`studio_id = $1`) or through a row that is. The
 * tests in repo.test.ts check this for each function that takes an id.
 */

/** Timestamps come back as Date (node-postgres, PGlite) or string; core wants ISO "Z" strings. */
const iso = (v: unknown) => new Date(v as string | Date).toISOString();
const isoOrNull = (v: unknown) => (v == null ? null : iso(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const json = (v: unknown) => JSON.stringify(v);

// --- Studios -------------------------------------------------------------------

export interface StudioRow {
  id: string;
  display_name: string | null;
  owner_email: string;
  profile: { services?: string; idealClients?: string; typicalEngagements?: string };
  voice: VoiceProfile | null;
  exclusions: Exclusions;
  backfill_months: number;
  stages: string[];
  onboarded_at: string | null;
}

const STUDIO_COLUMNS = "id, display_name, owner_email, profile, voice, exclusions, backfill_months, stages, onboarded_at";

const toStudio = (r: StudioRow): StudioRow => ({ ...r, onboarded_at: isoOrNull(r.onboarded_at) });

/** Sign-in: find or create the studio for a Google account. */
export async function upsertStudioForGoogle(db: Db, account: { sub: string; email: string; name: string | null }) {
  const [row] = await db.query<{ id: string; onboarded_at: unknown }>(
    `insert into studios (google_sub, owner_email, display_name) values ($1, $2, $3)
     on conflict (google_sub) do update set owner_email = excluded.owner_email
     returning id, onboarded_at`,
    [account.sub, account.email, account.name],
  );
  return { id: row!.id, onboardedAt: isoOrNull(row!.onboarded_at) };
}

export async function getStudio(db: Db, studioId: string): Promise<StudioRow> {
  const [row] = await db.query<StudioRow>(`select ${STUDIO_COLUMNS} from studios where id = $1`, [studioId]);
  if (!row) throw new Error("Studio not found");
  return toStudio(row);
}

export async function listStudioIds(db: Db): Promise<string[]> {
  return (await db.query<{ id: string }>("select id from studios")).map((r) => r.id);
}

export async function updateStudio(
  db: Db,
  studioId: string,
  patch: Partial<{ display_name: string | null; profile: StudioRow["profile"]; exclusions: Exclusions; voice: VoiceProfile; onboarded: boolean }>,
) {
  await db.query(
    `update studios set
       display_name = case when $2 then $3 else display_name end,
       profile      = coalesce($4::jsonb, profile),
       exclusions   = coalesce($5::jsonb, exclusions),
       voice        = coalesce($6::jsonb, voice),
       onboarded_at = case when $7 then coalesce(onboarded_at, now()) else onboarded_at end
     where id = $1`,
    [
      studioId,
      "display_name" in patch,
      patch.display_name ?? null,
      patch.profile ? json(patch.profile) : null,
      patch.exclusions ? json(patch.exclusions) : null,
      patch.voice ? json(patch.voice) : null,
      patch.onboarded ?? false,
    ],
  );
}

/** Cascades to every studio table, secrets included. */
export async function deleteStudio(db: Db, studioId: string) {
  await db.query("delete from studios where id = $1", [studioId]);
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

// --- Integrations ------------------------------------------------------------------

export type SyncState = "pending" | "backfilling" | "live" | "error" | "revoked";

export interface IntegrationRow {
  id: string;
  studio_id: string;
  account_email: string;
  sync_state: SyncState;
  sync_error: string | null;
  checkpoint: { processed?: number; page?: number } | null;
  last_synced_at: string | null;
}

const INTEGRATION_COLUMNS = "id, studio_id, account_email, sync_state, sync_error, checkpoint, last_synced_at";
const toIntegration = (r: IntegrationRow): IntegrationRow => ({ ...r, last_synced_at: isoOrNull(r.last_synced_at) });

export async function upsertGmailIntegration(db: Db, studioId: string, accountEmail: string, scopes: string[]) {
  const [row] = await db.query<{ id: string; sync_state: SyncState }>(
    `insert into integrations (studio_id, provider, account_email, scopes) values ($1, 'gmail', $2, $3::text[])
     on conflict (studio_id, provider, account_email)
       do update set scopes = excluded.scopes, revoked_at = null, sync_error = null
     returning id, sync_state`,
    [studioId, accountEmail, scopes],
  );
  return row!;
}

export async function getIntegration(db: Db, studioId: string): Promise<IntegrationRow | null> {
  const [row] = await db.query<IntegrationRow>(
    `select ${INTEGRATION_COLUMNS} from integrations where studio_id = $1 order by account_email limit 1`,
    [studioId],
  );
  return row ? toIntegration(row) : null;
}

/** Background jobs only: the event carries both ids, and they must agree. */
export async function getIntegrationForStudio(db: Db, studioId: string, integrationId: string): Promise<IntegrationRow> {
  const [row] = await db.query<IntegrationRow>(
    `select ${INTEGRATION_COLUMNS} from integrations where studio_id = $1 and id = $2`,
    [studioId, integrationId],
  );
  if (!row) throw new Error("Integration not found for this studio");
  return toIntegration(row);
}

export async function listLiveIntegrations(db: Db) {
  return db.query<{ id: string; studio_id: string }>(
    "select id, studio_id from integrations where sync_state = 'live' and revoked_at is null",
  );
}

export async function markIntegration(
  db: Db,
  studioId: string,
  integrationId: string,
  patch: Partial<{ sync_state: SyncState; sync_error: string | null; last_synced_at: string; checkpoint: IntegrationRow["checkpoint"] }>,
) {
  await db.query(
    `update integrations set
       sync_state     = coalesce($3, sync_state),
       sync_error     = case when $4 then $5 else sync_error end,
       last_synced_at = coalesce($6::timestamptz, last_synced_at),
       checkpoint     = coalesce($7::jsonb, checkpoint)
     where studio_id = $1 and id = $2`,
    [
      studioId,
      integrationId,
      patch.sync_state ?? null,
      "sync_error" in patch,
      patch.sync_error ?? null,
      patch.last_synced_at ?? null,
      patch.checkpoint ? json(patch.checkpoint) : null,
    ],
  );
}

export async function saveSecret(db: Db, studioId: string, integrationId: string, encryptedRefreshToken: string) {
  await db.query(
    `insert into integration_secrets (integration_id, refresh_token_encrypted)
     select id, $3 from integrations where studio_id = $1 and id = $2
     on conflict (integration_id) do update set refresh_token_encrypted = excluded.refresh_token_encrypted`,
    [studioId, integrationId, encryptedRefreshToken],
  );
}

export async function getSecret(db: Db, studioId: string, integrationId: string): Promise<string> {
  const [row] = await db.query<{ refresh_token_encrypted: string }>(
    `select s.refresh_token_encrypted from integration_secrets s
     join integrations i on i.id = s.integration_id
     where i.studio_id = $1 and i.id = $2`,
    [studioId, integrationId],
  );
  if (!row) throw new Error("No stored Gmail token for this integration");
  return row.refresh_token_encrypted;
}

export async function listSecrets(db: Db, studioId: string): Promise<string[]> {
  const rows = await db.query<{ refresh_token_encrypted: string }>(
    `select s.refresh_token_encrypted from integration_secrets s
     join integrations i on i.id = s.integration_id where i.studio_id = $1`,
    [studioId],
  );
  return rows.map((r) => r.refresh_token_encrypted);
}

// --- People ----------------------------------------------------------------------

interface PersonRow {
  id: string;
  name: string;
  relationship: Person["relationship"];
  referred_by_id: string | null;
  confirmed: boolean;
  emails: string[] | null;
  organization_ids: string[] | null;
}

export async function listPeople(db: Db, studioId: string): Promise<Person[]> {
  const rows = await db.query<PersonRow>(
    `select p.id, p.name, p.relationship, p.referred_by_id, p.confirmed,
            (select array_agg(e.email order by e.email) from person_emails e where e.person_id = p.id) as emails,
            (select array_agg(o.organization_id) from person_organizations o where o.person_id = p.id) as organization_ids
     from people p where p.studio_id = $1 order by p.name`,
    [studioId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    emails: r.emails ?? [],
    organizationIds: r.organization_ids ?? [],
    relationship: r.relationship,
    referredById: r.referred_by_id,
    confirmed: r.confirmed,
  }));
}

const nameFromHeader = (raw: string) => raw.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim() || null;

const titleCase = (s: string) =>
  s.replace(/[._-]+/g, " ").replace(/(^|\s)(\w)/g, (_, sep: string, c: string) => `${sep}${c.toUpperCase()}`);

/**
 * Find the person behind an address, or propose a new unconfirmed one (CN-06).
 * Matching is exact on email only; anything fuzzier is left for the user (CN-05).
 */
export async function resolvePerson(db: Db, studioId: string, rawAddress: string): Promise<string> {
  const email = emailAddress(rawAddress);
  const [existing] = await db.query<{ person_id: string }>(
    "select person_id from person_emails where studio_id = $1 and email = $2",
    [studioId, email],
  );
  if (existing) return existing.person_id;

  const relationship: Person["relationship"] = { value: "other", provenance: { source: null, method: "inferred", confidence: 0.3 } };
  const name = nameFromHeader(rawAddress) ?? titleCase(email.split("@")[0] ?? email);
  const [person] = await db.query<{ id: string }>(
    "insert into people (studio_id, name, relationship, confirmed) values ($1, $2, $3::jsonb, false) returning id",
    [studioId, name, json(relationship)],
  );
  // A concurrent insert may have claimed the address first; if so, use theirs and drop ours.
  const [claimed] = await db.query<{ person_id: string }>(
    `insert into person_emails (person_id, studio_id, email) values ($1, $2, $3)
     on conflict (studio_id, email) do update set email = excluded.email
     returning person_id`,
    [person!.id, studioId, email],
  );
  if (claimed!.person_id !== person!.id) {
    await db.query("delete from people where studio_id = $1 and id = $2", [studioId, person!.id]);
    return claimed!.person_id;
  }

  const domain = domainOf(email);
  if (domain && !CONSUMER_DOMAINS.has(domain)) {
    const [org] = await db.query<{ id: string }>(
      `insert into organizations (studio_id, domain, name) values ($1, $2, $3)
       on conflict (studio_id, domain) do update set domain = excluded.domain
       returning id`,
      [studioId, domain, titleCase(domain.split(".")[0] ?? domain)],
    );
    await db.query("insert into person_organizations (person_id, organization_id) values ($1, $2) on conflict do nothing", [person!.id, org!.id]);
  }
  return person!.id;
}

export async function setRelationship(db: Db, studioId: string, personId: string, value: RelationshipType) {
  const relationship: Person["relationship"] = { value, provenance: { source: null, method: "user_entered", confidence: 1 } };
  await db.query("update people set relationship = $3::jsonb, confirmed = true where studio_id = $1 and id = $2", [
    studioId,
    personId,
    json(relationship),
  ]);
}

/** An agent's suggestion never overrides what the user entered. */
export async function suggestRelationship(db: Db, studioId: string, personId: string, value: RelationshipType, source: string, confidence: number) {
  const relationship: Person["relationship"] = { value, provenance: { source, method: "inferred", confidence } };
  await db.query(
    `update people set relationship = $3::jsonb
     where studio_id = $1 and id = $2 and relationship->'provenance'->>'method' <> 'user_entered'`,
    [studioId, personId, json(relationship)],
  );
}

export async function personEmails(db: Db, studioId: string, personId: string): Promise<string[]> {
  const rows = await db.query<{ email: string }>("select email from person_emails where studio_id = $1 and person_id = $2", [studioId, personId]);
  return rows.map((r) => r.email);
}

/** "Not business": remove the person and every stored message with them. */
export async function deletePersonAndMail(db: Db, studioId: string, personId: string) {
  await db.query("delete from interactions where studio_id = $1 and person_id = $2", [studioId, personId]);
  await db.query("delete from people where studio_id = $1 and id = $2", [studioId, personId]);
}

/** EM-03, retroactive: remove stored mail and people matching an exclusion (exact address or %@domain). */
export async function purgeMatching(db: Db, studioId: string, likePattern: string) {
  await db.query("delete from interactions where studio_id = $1 and counterpart like $2", [studioId, likePattern]);
  await db.query(
    `delete from people where studio_id = $1 and id in
       (select person_id from person_emails where studio_id = $1 and email like $2)`,
    [studioId, likePattern],
  );
}

// --- Interactions ------------------------------------------------------------------

interface InteractionRow {
  id: string;
  thread_id: string;
  at: unknown;
  direction: "inbound" | "outbound";
  counterpart: string;
  person_id: string | null;
  subject: string;
  summary: string;
  expects_reply: boolean;
}

const INTERACTION_COLUMNS = "id, thread_id, at, direction, counterpart, person_id, subject, summary, expects_reply";

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

export type StoredInteraction = Interaction & { subject: string };

export async function listInteractions(db: Db, studioId: string): Promise<Interaction[]> {
  const rows = await db.query<InteractionRow>(`select ${INTERACTION_COLUMNS} from interactions where studio_id = $1 order by at`, [studioId]);
  return rows.map(toInteraction);
}

export async function interactionsByIds(db: Db, studioId: string, ids: string[]): Promise<StoredInteraction[]> {
  const rows = await db.query<InteractionRow>(
    `select ${INTERACTION_COLUMNS} from interactions where studio_id = $1 and id = any($2::text[]) order by at desc`,
    [studioId, ids],
  );
  return rows.map((r) => ({ ...toInteraction(r), subject: r.subject }));
}

export async function threadInteractions(db: Db, studioId: string, threadId: string): Promise<StoredInteraction[]> {
  const rows = await db.query<InteractionRow>(
    `select ${INTERACTION_COLUMNS} from interactions where studio_id = $1 and thread_id = $2 order by at`,
    [studioId, threadId],
  );
  return rows.map((r) => ({ ...toInteraction(r), subject: r.subject }));
}

/** Threads with activity since `since`, most recent first. */
export async function recentThreadIds(db: Db, studioId: string, since: string): Promise<string[]> {
  const rows = await db.query<{ thread_id: string }>(
    `select thread_id from interactions where studio_id = $1 and at >= $2
     group by thread_id order by max(at) desc`,
    [studioId, since],
  );
  return rows.map((r) => r.thread_id);
}

export async function recentOutboundIds(db: Db, studioId: string, limit: number): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    "select id from interactions where studio_id = $1 and direction = 'outbound' order by at desc limit $2",
    [studioId, limit],
  );
  return rows.map((r) => r.id);
}

/** Heuristic for LD-02 until extraction runs: did the user ask something or send a proposal? */
export function expectsReply(body: string): boolean {
  const text = body.slice(0, 2000);
  return /\?/.test(text) || /\b(proposal|estimate|quote|scope|attached|let me know)\b/i.test(text);
}

export async function insertInteraction(
  db: Db,
  studioId: string,
  row: {
    id: string;
    threadId: string;
    at: string;
    direction: "inbound" | "outbound";
    counterpart: string;
    counterpartName: string | null;
    personId: string;
    subject: string;
    summary: string;
    expectsReply: boolean;
  },
) {
  await db.query(
    `insert into interactions (id, studio_id, thread_id, at, direction, counterpart, counterpart_name, person_id, subject, summary, expects_reply)
     select $1, $2, $3, $4, $5, $6, $7, p.id, $9, $10, $11 from people p where p.studio_id = $2 and p.id = $8
     on conflict (studio_id, id) do nothing`,
    [row.id, studioId, row.threadId, row.at, row.direction, row.counterpart, row.counterpartName, row.personId, row.subject, row.summary, row.expectsReply],
  );
}

export async function setExtraction(db: Db, studioId: string, interactionId: string, extraction: unknown) {
  await db.query("update interactions set extraction = $3::jsonb where studio_id = $1 and id = $2", [studioId, interactionId, json(extraction)]);
}

/** Threads whose latest extraction found nothing for the user to answer. */
export async function threadsNotNeedingReply(db: Db, studioId: string): Promise<Set<string>> {
  const rows = await db.query<{ thread_id: string }>(
    "select thread_id from interactions where studio_id = $1 and extraction->>'needsReplyFromUser' = 'false'",
    [studioId],
  );
  return new Set(rows.map((r) => r.thread_id));
}

// --- Ingestion ledger and filter ---------------------------------------------------------

export async function hasSeen(db: Db, studioId: string, id: string) {
  const rows = await db.query("select 1 from seen_messages where studio_id = $1 and id = $2", [studioId, id]);
  return rows.length > 0;
}

export async function markSeen(db: Db, studioId: string, id: string, mailClass: MailClass) {
  if (mailClass === "undecided") throw new Error("Undecided mail must be classified before it is recorded");
  await db.query(
    "insert into seen_messages (studio_id, id, mail_class) values ($1, $2, $3) on conflict (studio_id, id) do update set mail_class = excluded.mail_class",
    [studioId, id, mailClass],
  );
}

export async function filterContext(db: Db, studio: StudioRow): Promise<FilterContext> {
  const [known, wrote] = await Promise.all([
    db.query<{ email: string }>(
      `select e.email from person_emails e join people p on p.id = e.person_id
       where e.studio_id = $1 and p.confirmed`,
      [studio.id],
    ),
    db.query<{ counterpart: string }>(
      "select distinct counterpart from interactions where studio_id = $1 and direction = 'outbound'",
      [studio.id],
    ),
  ]);
  return {
    exclusions: studio.exclusions,
    knownBusinessContacts: new Set(known.map((r) => r.email)),
    addressesUserWroteTo: new Set(wrote.map((r) => r.counterpart)),
  };
}

// --- Projects ---------------------------------------------------------------------

interface ProjectRow {
  id: string;
  title: string;
  stage: string;
  service: string | null;
  estimated_value: unknown;
  expected_start: string | null;
  next_step: string | null;
  paid_amount: unknown;
  paid_at: string | null;
  origin_signal_id: string | null;
  person_ids: string[] | null;
  thread_ids: string[] | null;
}

export async function listProjects(db: Db, studioId: string): Promise<Project[]> {
  const rows = await db.query<ProjectRow>(
    `select p.id, p.title, p.stage, p.service, p.estimated_value, to_char(p.expected_start, 'YYYY-MM-DD') as expected_start,
            p.next_step, p.paid_amount, to_char(p.paid_at, 'YYYY-MM-DD') as paid_at, p.origin_signal_id,
            (select array_agg(pp.person_id) from project_people pp where pp.project_id = p.id) as person_ids,
            (select array_agg(pt.thread_id) from project_threads pt where pt.project_id = p.id) as thread_ids
     from projects p where p.studio_id = $1`,
    [studioId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    stage: r.stage,
    personIds: r.person_ids ?? [],
    threadIds: r.thread_ids ?? [],
    service: r.service,
    estimatedValue: num(r.estimated_value),
    expectedStart: r.expected_start ? `${r.expected_start}T00:00:00.000Z` : null,
    nextStep: r.next_step,
    paidAmount: num(r.paid_amount),
    paidAt: r.paid_at,
    originSignalId: r.origin_signal_id,
  }));
}

export async function createProject(
  db: Db,
  studioId: string,
  p: { title: string; stage: string; originSignalId: string | null; personId: string | null; threadIds: string[] },
): Promise<string> {
  const [project] = await db.query<{ id: string }>(
    "insert into projects (studio_id, title, stage, origin_signal_id) values ($1, $2, $3, $4) returning id",
    [studioId, p.title, p.stage, p.originSignalId],
  );
  if (p.personId) {
    // Only link a person from the same studio.
    await db.query(
      "insert into project_people (project_id, person_id) select $1, id from people where studio_id = $2 and id = $3",
      [project!.id, studioId, p.personId],
    );
  }
  for (const threadId of new Set(p.threadIds)) {
    await db.query("insert into project_threads (project_id, thread_id) values ($1, $2) on conflict do nothing", [project!.id, threadId]);
  }
  return project!.id;
}

export async function updateProject(
  db: Db,
  studioId: string,
  projectId: string,
  p: { title: string; stage: string | null; estimatedValue: number | null; nextStep: string | null; paidAmount: number | null; paidAt: string | null },
) {
  await db.query(
    `update projects set title = $3, stage = coalesce($4, stage), estimated_value = $5, next_step = $6, paid_amount = $7, paid_at = $8::date
     where studio_id = $1 and id = $2`,
    [studioId, projectId, p.title, p.stage, p.estimatedValue, p.nextStep, p.paidAmount, p.paidAt],
  );
}

// --- Signals ----------------------------------------------------------------------

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
  created_at: unknown;
}

const SIGNAL_COLUMNS = `id, type, coming_up_kind, person_id, evidence, reason, confidence,
  to_char(window_opens, 'YYYY-MM-DD') as window_opens, to_char(reach_out_by, 'YYYY-MM-DD') as reach_out_by, status, created_at`;

const toSignal = (r: SignalRow): OpportunitySignal => ({
  id: r.id,
  type: r.type,
  comingUpKind: r.coming_up_kind,
  personId: r.person_id,
  evidence: r.evidence,
  reason: r.reason,
  confidence: Number(r.confidence),
  windowOpens: r.window_opens,
  reachOutBy: r.reach_out_by,
  status: r.status,
  createdAt: iso(r.created_at),
});

export async function listSignals(db: Db, studioId: string): Promise<OpportunitySignal[]> {
  return (await db.query<SignalRow>(`select ${SIGNAL_COLUMNS} from signals where studio_id = $1`, [studioId])).map(toSignal);
}

export async function getSignal(db: Db, studioId: string, signalId: string): Promise<OpportunitySignal | null> {
  const [row] = await db.query<SignalRow>(`select ${SIGNAL_COLUMNS} from signals where studio_id = $1 and id = $2`, [studioId, signalId]);
  return row ? toSignal(row) : null;
}

/** Insert or refresh signals. Status is never overwritten: the user's decisions stick. */
export async function upsertSignals(db: Db, studioId: string, signals: OpportunitySignal[]) {
  for (const s of signals) {
    await db.query(
      `insert into signals (studio_id, id, type, coming_up_kind, person_id, evidence, reason, confidence, window_opens, reach_out_by)
       values ($1, $2, $3, $4, (select id from people where studio_id = $1 and id = $5), $6::text[], $7, $8, $9::date, $10::date)
       on conflict (studio_id, id) do update set
         evidence = excluded.evidence, reason = excluded.reason, confidence = excluded.confidence,
         window_opens = excluded.window_opens, reach_out_by = excluded.reach_out_by`,
      [studioId, s.id, s.type, s.comingUpKind, s.personId, s.evidence, s.reason, s.confidence, s.windowOpens, s.reachOutBy],
    );
  }
}

export async function setSignalStatus(
  db: Db,
  studioId: string,
  signalId: string,
  status: OpportunitySignal["status"],
  extra: { snoozedUntil?: string | null; wrongReason?: string | null } = {},
) {
  await db.query(
    "update signals set status = $3, snoozed_until = $4::date, wrong_reason = coalesce($5, wrong_reason) where studio_id = $1 and id = $2",
    [studioId, signalId, status, extra.snoozedUntil ?? null, extra.wrongReason ?? null],
  );
}

/** Snoozes that have run out come back. */
export async function reopenExpiredSnoozes(db: Db, studioId: string, today: string) {
  await db.query(
    "update signals set status = 'open', snoozed_until = null where studio_id = $1 and status = 'snoozed' and snoozed_until <= $2::date",
    [studioId, today],
  );
}

// --- Activity log (TR-01) ----------------------------------------------------------

export type ActionAgent = "relationship_keeper" | "conversation_reader" | "draft_writer" | "user";

export async function logAction(
  db: Db,
  studioId: string,
  a: { agent: ActionAgent; trigger: string; evidence?: string[]; proposed: Record<string, unknown>; confidence?: number | null; approval: "pending" | "approved" | "rejected" | "undone" },
) {
  await db.query(
    `insert into agent_actions (studio_id, agent, trigger, evidence, proposed, confidence, approval)
     values ($1, $2, $3, $4::text[], $5::jsonb, $6, $7)`,
    [studioId, a.agent, a.trigger, a.evidence ?? [], json(a.proposed), a.confidence ?? null, a.approval],
  );
}

export async function listActions(db: Db, studioId: string, limit = 200) {
  const rows = await db.query<{ id: string; agent: ActionAgent; trigger: string; proposed: Record<string, unknown>; approval: string; at: unknown }>(
    "select id, agent, trigger, proposed, approval, at from agent_actions where studio_id = $1 order by at desc limit $2",
    [studioId, limit],
  );
  return rows.map((r) => ({ ...r, at: iso(r.at) }));
}

// --- Export (TR-02) ----------------------------------------------------------------

/** Everything stored for a studio, except OAuth secrets. */
export async function exportStudio(db: Db, studioId: string) {
  const q = (sql: string) => db.query(sql, [studioId]);
  return {
    exportedAt: new Date().toISOString(),
    studio: (await q(`select ${STUDIO_COLUMNS}, created_at from studios where id = $1`))[0],
    integrations: await q("select id, provider, account_email, scopes, sync_state, last_synced_at from integrations where studio_id = $1"),
    organizations: await q("select * from organizations where studio_id = $1"),
    people: await q("select * from people where studio_id = $1"),
    personEmails: await q("select * from person_emails where studio_id = $1"),
    interactions: await q("select * from interactions where studio_id = $1 order by at"),
    projects: await q("select * from projects where studio_id = $1"),
    signals: await q("select * from signals where studio_id = $1"),
    activity: await q("select * from agent_actions where studio_id = $1 order by at"),
  };
}

// --- Findings report and Gate 0 ------------------------------------------------------

/** How much mail was read as business, and how much was set aside unread. */
export async function mailClassCounts(db: Db, studioId: string): Promise<{ business: number; personal: number; automated: number }> {
  const rows = await db.query<{ mail_class: string; n: unknown }>(
    "select mail_class, count(*) as n from seen_messages where studio_id = $1 group by mail_class",
    [studioId],
  );
  const get = (c: string) => Number(rows.find((r) => r.mail_class === c)?.n ?? 0);
  return { business: get("business"), personal: get("personal"), automated: get("automated") };
}

/** Actions that count as acting on a finding: a draft written, a project started, an item marked done. */
const ACTED_TRIGGERS = ["create_project", "done"];

export async function gateZeroEvents(db: Db, studioId: string): Promise<{ firstViewedAt: string | null; actionsAt: string[] }> {
  const [viewed] = await db.query<{ at: unknown }>(
    "select min(at) as at from agent_actions where studio_id = $1 and trigger = 'report_viewed'",
    [studioId],
  );
  const acted = await db.query<{ at: unknown }>(
    `select at from agent_actions where studio_id = $1
     and (agent = 'draft_writer' or (agent = 'user' and trigger = any($2::text[])))`,
    [studioId, ACTED_TRIGGERS],
  );
  return { firstViewedAt: isoOrNull(viewed?.at), actionsAt: acted.map((r) => iso(r.at)) };
}

/** Record the first time the report is opened; later views don't matter for Gate 0. */
export async function recordReportView(db: Db, studioId: string) {
  await db.query(
    `insert into agent_actions (studio_id, agent, trigger, proposed, approval)
     select $1, 'user', 'report_viewed', '{}'::jsonb, 'approved'
     where not exists (select 1 from agent_actions where studio_id = $1 and trigger = 'report_viewed')`,
    [studioId],
  );
}
