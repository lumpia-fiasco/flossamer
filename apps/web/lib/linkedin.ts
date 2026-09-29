import {
  addDays,
  companyChanged,
  isoDay,
  matchConnections,
  parseLinkedInConnections,
  parseLinkedInNotification,
  personByName,
  type OpportunitySignal,
  type Person,
} from "@flossamer/core";
import * as repo from "@flossamer/db";
import type { Db } from "@flossamer/db";
import type { SourceHeaders } from "@flossamer/mail";

/**
 * LinkedIn from data the user owns (PRD 6.12). Job changes become Coming up
 * items only for confirmed people, and ids start with "coming_up:li-" so the
 * detector refresh never closes them.
 */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function jobChangeSignal(o: { id: string; person: Person; reason: string; evidence: string; now: string }): OpportunitySignal {
  return {
    id: o.id,
    type: "coming_up",
    comingUpKind: "job_change",
    personId: o.person.id,
    evidence: [o.evidence],
    reason: o.reason,
    confidence: 0.75,
    windowOpens: null,
    reachOutBy: isoDay(addDays(o.now, 14)),
    status: "open",
    createdAt: o.now,
  };
}

/** LI-01 to LI-03: import Connections.csv and surface job changes since the last import. */
export async function importLinkedInExport(db: Db, studioId: string, csv: string) {
  const { connections, skipped } = parseLinkedInConnections(csv);
  const people = await repo.listPeople(db, studioId);
  const matches = matchConnections(connections, people);
  const result = await repo.importLinkedIn(db, studioId, connections, matches, companyChanged);

  const now = new Date().toISOString();
  const confirmed = new Map(people.filter((p) => p.confirmed).map((p) => [p.id, p]));
  const signals = result.changes
    .filter((c) => confirmed.has(c.personId))
    .map((c) =>
      jobChangeSignal({
        id: `coming_up:li-job:${c.personId}:${slug(c.company)}`,
        person: confirmed.get(c.personId)!,
        reason: `Per your LinkedIn export, ${c.name} is now ${c.after}${c.before ? ` (was ${c.before})` : ""}. A new role is often a chance to bring in people they trust.`,
        evidence: `linkedin:${c.name}`,
        now,
      }),
    );
  await repo.upsertSignals(db, studioId, signals);
  await repo.logAction(db, studioId, {
    agent: "user",
    trigger: "linkedin_import",
    proposed: { total: result.total, matchedByEmail: result.matchedByEmail, suggestedByName: result.suggestedByName, jobChanges: signals.length },
    approval: "approved",
  });
  return { ...result, skipped, jobChangeSignals: signals.length };
}

/**
 * LI-06, LI-07 (opt-in): a LinkedIn notification email, from its sender and
 * subject line only. The body is never fetched.
 */
export async function handleLinkedInNotification(db: Db, studioId: string, messageId: string, h: SourceHeaders, people: Person[]) {
  const n = parseLinkedInNotification(h.from, h.subject);
  if (!n) return;
  const person = personByName(people.filter((p) => p.confirmed), n.name);
  if (!person) return; // Only people the user has confirmed; never strangers from their network.

  if (n.kind === "post") {
    await repo.addLinkedInEvent(db, studioId, { personId: person.id, kind: "post", text: n.text ?? "Shared a post", at: h.date, messageId });
    return;
  }

  const role = [n.position, n.company].filter(Boolean).join(" at ");
  await repo.addLinkedInEvent(db, studioId, { personId: person.id, kind: "new_position", text: role || "Started a new position", at: h.date, messageId });
  // Old notifications from the backfill are context, not something to act on now.
  if (Date.parse(h.date) < Date.now() - 60 * 86_400_000) return;
  const now = new Date().toISOString();
  await repo.upsertSignals(db, studioId, [
    jobChangeSignal({
      id: `coming_up:li-job:${person.id}:${slug(n.company ?? messageId)}`,
      person,
      reason: `LinkedIn says ${person.name} started a new position${role ? ` as ${role}` : ""}. A new role is often a chance to bring in people they trust.`,
      evidence: `linkedin-email:${messageId}`,
      now,
    }),
  ]);
}
