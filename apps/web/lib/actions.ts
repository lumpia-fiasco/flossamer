"use server";

import { draftEmail, type DraftPurpose } from "@flossamer/agents";
import { RelationshipType, addDays, isoDay, type OpportunitySignal, type VoiceProfile } from "@flossamer/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDemo } from "@/lib/env";
import { EVENTS, inngest } from "@/lib/inngest/client";
import { gmailFor } from "@/lib/ingest";
import * as repo from "@/lib/repo";
import { currentStudio } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

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

async function refresh() {
  revalidatePath("/", "layout");
}

// --- Signal cards (TD-05) ------------------------------------------------------

export async function snoozeSignal(signalId: string, days = 7): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  const until = isoDay(addDays(new Date().toISOString(), days));
  await repo.setSignalStatus(db, studioId, signalId, "snoozed", { snoozed_until: until });
  await repo.logAction(db, studioId, { agent: "user", trigger: "snooze", evidence: [signalId], proposed: { until }, approval: "approved" });
  await refresh();
  return { ok: true };
}

export async function completeSignal(signalId: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  await repo.setSignalStatus(db, studioId, signalId, "done");
  await repo.logAction(db, studioId, { agent: "user", trigger: "done", evidence: [signalId], proposed: {}, approval: "approved" });
  await refresh();
  return { ok: true };
}

/** LD-04: "Not relevant". The reason feeds the evaluation set. */
export async function markWrong(signalId: string, reason: string | null): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  await repo.setSignalStatus(db, studioId, signalId, "wrong", { wrong_reason: reason });
  await repo.logAction(db, studioId, { agent: "user", trigger: "marked_wrong", evidence: [signalId], proposed: { reason }, approval: "rejected" });
  await refresh();
  return { ok: true };
}

/** VC-02, VC-03: write a grounded draft and save it to Gmail Drafts. Never sends. */
export async function openDraft(signalId: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId, email } = await currentStudio();

  const { data: row, error } = await db.from("signals").select("*").eq("studio_id", studioId).eq("id", signalId).single();
  if (error) return { ok: false, message: "That item is no longer available." };
  const signal = repo.toSignal(row);

  const [studio, people, integration] = await Promise.all([
    repo.getStudio(db, studioId),
    repo.listPeople(db, studioId),
    db.from("integrations").select("id").eq("studio_id", studioId).single(),
  ]);
  const person = people.find((p) => p.id === signal.personId);
  if (!person) return { ok: false, message: "Drafts need a person to write to." };
  if (integration.error) return { ok: false, message: "Connect Gmail first." };

  // Read the evidence thread in full, transiently, for grounding.
  const { data: evidence } = await db
    .from("interactions")
    .select("id, thread_id, counterpart, subject, at, direction")
    .eq("studio_id", studioId)
    .in("id", signal.evidence)
    .order("at", { ascending: false });
  const anchor = evidence?.[0];
  const gmail = await gmailFor(createAdminClient(), integration.data.id);
  const thread = anchor ? await gmail.thread(anchor.thread_id) : [];
  const { data: known } = anchor
    ? await db.from("interactions").select("id").eq("studio_id", studioId).eq("thread_id", anchor.thread_id)
    : { data: [] };
  const businessIds = new Set((known ?? []).map((k) => k.id as string));
  const businessMessages = thread.filter((m) => businessIds.has(m.id));

  const purpose = PURPOSE[signal.type];
  const draft = await draftEmail({
    purpose,
    voice: studio.voice ?? DEFAULT_VOICE,
    person,
    reason: signal.reason,
    history: businessMessages.map(
      (m) => `[${m.headers.date.slice(0, 10)}] ${m.headers.labels.includes("SENT") ? "You" : person.name}: ${m.body.slice(0, 1500)}`,
    ),
    studioProfile: repo.studioContext(studio),
  });

  const inThread = purpose === "reply" || purpose === "follow_up";
  const lastMessage = businessMessages.at(-1);
  const to = anchor?.counterpart ?? person.emails.at(-1)!;
  const subject = inThread && anchor?.subject ? (anchor.subject.startsWith("Re:") ? anchor.subject : `Re: ${anchor.subject}`) : draft.subject;
  const saved = await gmail.createDraft({
    threadId: inThread ? (anchor?.thread_id ?? null) : null,
    to,
    subject,
    body: draft.body,
    inReplyTo: inThread ? (lastMessage?.headers.messageId ?? null) : null,
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
  await refresh();
  return { ok: true };
}

/** Not a business contact: exclude their address from now on and remove what was stored (EM-03). */
export async function excludePerson(personId: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  const studio = await repo.getStudio(db, studioId);
  const { data: emails } = await db.from("person_emails").select("email").eq("studio_id", studioId).eq("person_id", personId);
  const senders = [...new Set([...studio.exclusions.senders, ...(emails ?? []).map((e) => e.email as string)])];
  await db.from("studios").update({ exclusions: { ...studio.exclusions, senders } }).eq("id", studioId);
  await db.from("interactions").delete().eq("studio_id", studioId).eq("person_id", personId);
  await db.from("people").delete().eq("studio_id", studioId).eq("id", personId);
  await repo.logAction(db, studioId, { agent: "user", trigger: "exclude_person", evidence: [], proposed: { senders: (emails ?? []).map((e) => e.email) }, approval: "approved" });
  await refresh();
  return { ok: true };
}

// --- Work (WK-01 to WK-04, WK-11) ---------------------------------------------------

export async function createProjectFromSignal(signalId: string): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  const { data: row } = await db.from("signals").select("*").eq("studio_id", studioId).eq("id", signalId).single();
  if (!row) return { ok: false, message: "That item is no longer available." };
  const signal = repo.toSignal(row);
  const [studio, people] = await Promise.all([repo.getStudio(db, studioId), repo.listPeople(db, studioId)]);
  const person = people.find((p) => p.id === signal.personId);
  const { data: evidence } = await db.from("interactions").select("thread_id, subject").eq("studio_id", studioId).in("id", signal.evidence);

  const { data: project, error } = await db
    .from("projects")
    .insert({
      studio_id: studioId,
      title: evidence?.[0]?.subject || `Project with ${person?.name ?? "new client"}`,
      stage: studio.stages[0] ?? "Conversation",
      origin_signal_id: signal.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  if (person) await db.from("project_people").insert({ project_id: project.id, person_id: person.id });
  const threads = [...new Set((evidence ?? []).map((e) => e.thread_id as string))];
  if (threads.length) await db.from("project_threads").insert(threads.map((thread_id) => ({ project_id: project.id, thread_id })));
  await repo.setSignalStatus(db, studioId, signalId, "done");
  await refresh();
  return { ok: true };
}

export async function updateProject(projectId: string, form: FormData): Promise<void> {
  if (isDemo) return;
  const { db, studioId } = await currentStudio();
  const num = (k: string) => {
    const v = String(form.get(k) ?? "").replace(/[$,\s]/g, "");
    return v === "" ? null : Number(v);
  };
  const text = (k: string) => (String(form.get(k) ?? "").trim() || null);
  const paidAmount = num("paid_amount");
  await db
    .from("projects")
    .update({
      title: text("title") ?? "Untitled project",
      stage: text("stage"),
      estimated_value: num("estimated_value"),
      next_step: text("next_step"),
      paid_amount: paidAmount,
      paid_at: paidAmount === null ? null : (text("paid_at") ?? isoDay(new Date().toISOString())),
    })
    .eq("studio_id", studioId)
    .eq("id", projectId);
  await refresh();
}

// --- Studio settings --------------------------------------------------------------

const lines = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export async function saveStudio(form: FormData): Promise<void> {
  if (isDemo) return;
  const { db, studioId } = await currentStudio();
  const studio = await repo.getStudio(db, studioId);
  await db
    .from("studios")
    .update({
      display_name: String(form.get("display_name") ?? "").trim() || null,
      profile: {
        services: String(form.get("services") ?? "").trim(),
        typicalEngagements: String(form.get("typicalEngagements") ?? "").trim(),
        idealClients: String(form.get("idealClients") ?? "").trim(),
      },
      exclusions: form.has("excluded_senders")
        ? { senders: lines(form.get("excluded_senders")), domains: lines(form.get("excluded_domains")), labels: studio.exclusions.labels }
        : studio.exclusions,
    })
    .eq("id", studioId);
  if (form.has("excluded_senders")) await applyExclusions(db, studioId, lines(form.get("excluded_senders")), lines(form.get("excluded_domains")));
  await refresh();
}

/** EM-03: exclusions are retroactive. Remove stored mail and people that now fall inside them. */
async function applyExclusions(db: Awaited<ReturnType<typeof currentStudio>>["db"], studioId: string, senders: string[], domains: string[]) {
  const patterns = [...senders.map((s) => s), ...domains.map((d) => `%@${d.replace(/^@/, "")}`)];
  for (const pattern of patterns) {
    await db.from("interactions").delete().eq("studio_id", studioId).like("counterpart", pattern);
    const { data: emails } = await db.from("person_emails").select("person_id").eq("studio_id", studioId).like("email", pattern);
    const ids = [...new Set((emails ?? []).map((e) => e.person_id as string))];
    if (ids.length) await db.from("people").delete().eq("studio_id", studioId).in("id", ids);
  }
}

export async function finishOnboarding(form: FormData): Promise<void> {
  if (!isDemo) {
    await saveStudio(form);
    const { db, studioId } = await currentStudio();
    await db.from("studios").update({ onboarded_at: new Date().toISOString() }).eq("id", studioId);
  }
  redirect("/");
}

export async function resync(): Promise<ActionResult> {
  if (isDemo) return DEMO;
  const { db, studioId } = await currentStudio();
  const { data } = await db.from("integrations").select("id").eq("studio_id", studioId).single();
  if (!data) return { ok: false, message: "Connect Gmail first." };
  await inngest.send({ name: EVENTS.syncRequested, data: { studioId, integrationId: data.id } });
  return { ok: true };
}

/** TR-03: revoke Google access and delete everything. */
export async function deleteEverything(): Promise<void> {
  if (isDemo) redirect("/");
  const { db, studioId } = await currentStudio();
  const admin = createAdminClient();
  const { data: integrations } = await admin.from("integrations").select("id").eq("studio_id", studioId);
  for (const { id } of integrations ?? []) {
    const { data: secret } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("integration_id", id).single();
    if (secret) {
      const { decrypt } = await import("@/lib/crypto");
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(secret.refresh_token_encrypted))}`, { method: "POST" }).catch(() => {});
    }
  }
  const { data: user } = await db.auth.getUser();
  await admin.from("studios").delete().eq("id", studioId); // cascades to every studio table
  if (user.user) await admin.auth.admin.deleteUser(user.user.id);
  await db.auth.signOut();
  redirect("/login?error=Your%20account%20and%20data%20were%20deleted.");
}

export async function signOut(): Promise<void> {
  if (!isDemo) {
    const { db } = await currentStudio();
    await db.auth.signOut();
  }
  redirect("/login");
}
