"use server";

import { draftEmail, type DraftPurpose } from "@flossamer/agents";
import { RelationshipType, addDays, isoDay, type OpportunitySignal, type VoiceProfile } from "@flossamer/core";
import * as repo from "@flossamer/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signOut as authSignOut } from "@/auth";
import { decrypt } from "@/lib/crypto";
import { isDemo } from "@/lib/env";
import { EVENTS, inngest } from "@/lib/inngest/client";
import { gmailFor } from "@/lib/ingest";
import { currentStudio } from "@/lib/session";

export type ActionResult = { ok: true; url?: string } | { ok: false; message: string };

const DEMO: ActionResult = { ok: false, message: "This is the sample studio. Connect Gmail to use actions." };

const DEFAULT_VOICE: VoiceProfile = { tone: "Warm, direct and brief.", typicalLength: "short", greetings: ["Hi"], signOffs: ["Best"], avoid: [] };

const PURPOSE: Record<OpportunitySignal["type"], DraftPurpose> = {
  inquiry: "reply",
  intro: "reply",
  waiting: "reply",
  stalled: "follow_up",
  reconnect: "reconnect",
  coming_up: "coming_up",
};

const refresh = () => revalidatePath("/", "layout");

// --- Signal cards (TD-05) ------------------------------------------------------

export async function snoozeSignal(signalId: string, days = 7): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  const until = isoDay(addDays(new Date().toISOString(), days));
  await repo.setSignalStatus(db, studioId, signalId, "snoozed", { snoozedUntil: until });
  await repo.logAction(db, studioId, { agent: "user", trigger: "snooze", evidence: [signalId], proposed: { until }, approval: "approved" });
  refresh();
  return { ok: true };
}

/** LD-04: "Not relevant". The reason feeds the evaluation set. */
export async function markWrong(signalId: string, reason: string | null): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  await repo.setSignalStatus(db, studioId, signalId, "wrong", { wrongReason: reason });
  await repo.logAction(db, studioId, { agent: "user", trigger: "marked_wrong", evidence: [signalId], proposed: { reason }, approval: "rejected" });
  refresh();
  return { ok: true };
}

/** VC-02, VC-03: write a grounded draft and save it to Gmail Drafts. Never sends. */
export async function openDraft(signalId: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId, email } = await currentStudio();

  const signal = await repo.getSignal(db, studioId, signalId);
  if (!signal) return { ok: false, message: "That item is no longer available." };
  const [studio, people, integration] = await Promise.all([
    repo.getStudio(db, studioId),
    repo.listPeople(db, studioId),
    repo.getIntegration(db, studioId),
  ]);
  const person = people.find((p) => p.id === signal.personId);
  if (!person) return { ok: false, message: "Drafts need a person to write to." };
  if (!integration) return { ok: false, message: "Connect Gmail first." };

  // Read the evidence thread in full, transiently, for grounding.
  const [anchor] = await repo.interactionsByIds(db, studioId, signal.evidence);
  const gmail = await gmailFor(studioId, integration.id);
  const businessIds = new Set(anchor ? (await repo.threadInteractions(db, studioId, anchor.threadId)).map((i) => i.id) : []);
  const businessMessages = anchor ? (await gmail.thread(anchor.threadId)).filter((m) => businessIds.has(m.id)) : [];

  const purpose = PURPOSE[signal.type];
  let draft;
  try {
    draft = await draftEmail({
      purpose,
      voice: studio.voice ?? DEFAULT_VOICE,
      person,
      reason: signal.reason,
      history: businessMessages.map(
        (m) => `[${m.headers.date.slice(0, 10)}] ${m.headers.labels.includes("SENT") ? "You" : person.name}: ${m.body.slice(0, 1500)}`,
      ),
      studioProfile: repo.studioContext(studio),
    });
  } catch {
    return { ok: false, message: "Couldn't write a draft just now. Please try again." };
  }

  const inThread = purpose === "reply" || purpose === "follow_up";
  const subject =
    inThread && anchor?.subject ? (/^re:/i.test(anchor.subject) ? anchor.subject : `Re: ${anchor.subject}`) : draft.subject;
  const saved = await gmail.createDraft({
    threadId: inThread ? (anchor?.threadId ?? null) : null,
    to: anchor?.counterpart ?? person.emails.at(-1)!,
    subject,
    body: draft.body,
    inReplyTo: inThread ? (businessMessages.at(-1)?.headers.messageId ?? null) : null,
  });

  await repo.logAction(db, studioId, {
    agent: "draft_writer",
    trigger: `draft:${signal.type}`,
    evidence: signal.evidence,
    proposed: { gmailDraftId: saved.id, subject, groundedIn: draft.groundedIn },
    confidence: signal.confidence,
    approval: "pending",
  });

  const account = email ? `authuser=${encodeURIComponent(email)}` : "";
  return { ok: true, url: `https://mail.google.com/mail/?${account}#drafts?compose=${saved.message.id}` };
}

// --- People (CN-05, CN-06, RL-01) -----------------------------------------------

export async function confirmPerson(personId: string, relationship: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const parsed = RelationshipType.safeParse(relationship);
  if (!parsed.success) return { ok: false, message: "Unknown relationship type." };
  const { db, studioId } = await currentStudio();
  await repo.setRelationship(db, studioId, personId, parsed.data);
  await repo.logAction(db, studioId, { agent: "user", trigger: "confirm_person", evidence: [personId], proposed: { relationship: parsed.data }, approval: "approved" });
  refresh();
  return { ok: true };
}

/** Not a business contact: exclude their addresses and remove what was stored (EM-03). */
export async function excludePerson(personId: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  const [studio, emails] = await Promise.all([repo.getStudio(db, studioId), repo.personEmails(db, studioId, personId)]);
  const senders = [...new Set([...studio.exclusions.senders, ...emails])];
  await repo.updateStudio(db, studioId, { exclusions: { ...studio.exclusions, senders } });
  await repo.deletePersonAndMail(db, studioId, personId);
  await repo.logAction(db, studioId, { agent: "user", trigger: "exclude_person", proposed: { senders: emails }, approval: "approved" });
  refresh();
  return { ok: true };
}

// --- Work (WK-01 to WK-04, WK-11) ---------------------------------------------------

export async function createProjectFromSignal(signalId: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  const signal = await repo.getSignal(db, studioId, signalId);
  if (!signal) return { ok: false, message: "That item is no longer available." };
  const [studio, people, evidence] = await Promise.all([
    repo.getStudio(db, studioId),
    repo.listPeople(db, studioId),
    repo.interactionsByIds(db, studioId, signal.evidence),
  ]);
  const person = people.find((p) => p.id === signal.personId);
  await repo.createProject(db, studioId, {
    title: evidence[0]?.subject || `Project with ${person?.name ?? "new client"}`,
    stage: studio.stages[0] ?? "Conversation",
    originSignalId: signal.id,
    personId: person?.id ?? null,
    threadIds: evidence.map((e) => e.threadId),
  });
  await repo.setSignalStatus(db, studioId, signalId, "done");
  await repo.logAction(db, studioId, { agent: "user", trigger: "create_project", evidence: signal.evidence, proposed: { signalId }, approval: "approved" });
  refresh();
  return { ok: true };
}

export async function updateProject(projectId: string, form: FormData): Promise<void> {
  if (isDemo) return;
  const { db, studioId } = await currentStudio();
  const num = (k: string) => {
    const v = String(form.get(k) ?? "").replace(/[$,\s]/g, "");
    return v === "" || Number.isNaN(Number(v)) ? null : Number(v);
  };
  const text = (k: string) => String(form.get(k) ?? "").trim() || null;
  const paidAmount = num("paid_amount");
  await repo.updateProject(db, studioId, projectId, {
    title: text("title") ?? "Untitled project",
    stage: text("stage"),
    estimatedValue: num("estimated_value"),
    nextStep: text("next_step"),
    paidAmount,
    paidAt: paidAmount === null ? null : isoDay(new Date().toISOString()),
  });
  refresh();
}

// --- Studio settings --------------------------------------------------------------

const lines = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);

export async function saveStudio(form: FormData): Promise<void> {
  if (isDemo) return;
  const { db, studioId } = await currentStudio();
  const studio = await repo.getStudio(db, studioId);
  const exclusions = form.has("excluded_senders")
    ? { senders: lines(form.get("excluded_senders")), domains: lines(form.get("excluded_domains")), labels: studio.exclusions.labels }
    : studio.exclusions;

  await repo.updateStudio(db, studioId, {
    display_name: String(form.get("display_name") ?? "").trim() || null,
    profile: {
      services: String(form.get("services") ?? "").trim(),
      typicalEngagements: String(form.get("typicalEngagements") ?? "").trim(),
      idealClients: String(form.get("idealClients") ?? "").trim(),
    },
    exclusions,
  });

  // EM-03: exclusions are retroactive.
  for (const sender of exclusions.senders) await repo.purgeMatching(db, studioId, sender);
  for (const domain of exclusions.domains) await repo.purgeMatching(db, studioId, `%@${domain}`);
  refresh();
}

export async function finishOnboarding(form: FormData): Promise<void> {
  if (!isDemo) {
    await saveStudio(form);
    const { db, studioId } = await currentStudio();
    await repo.updateStudio(db, studioId, { onboarded: true });
  }
  redirect("/");
}

export async function resync(): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  const integration = await repo.getIntegration(db, studioId);
  if (!integration) return { ok: false, message: "Connect Gmail first." };
  await inngest.send({ name: EVENTS.syncRequested, data: { studioId, integrationId: integration.id } });
  return { ok: true };
}

/** TR-03: revoke Google access and delete everything. */
export async function deleteEverything(): Promise<void> {
  if (isDemo) redirect("/");
  const { db, studioId } = await currentStudio();
  for (const encrypted of await repo.listSecrets(db, studioId)) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(encrypted))}`, { method: "POST" }).catch(() => {});
  }
  await repo.deleteStudio(db, studioId); // cascades to every studio table, secrets included
  await authSignOut({ redirectTo: "/login?error=deleted" });
}

export async function signOut(): Promise<void> {
  if (isDemo) redirect("/");
  await authSignOut({ redirectTo: "/login" });
}
