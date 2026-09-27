import { VoiceProfile, type Person } from "@flossamer/core";
import { z } from "zod";
import { modelFor, structured } from "./client";

/**
 * Draft writer (CN-07, VC-01 to VC-03, MK-11). Drafts are saved to Gmail Drafts
 * for the user to edit and send; nothing here sends mail.
 */

export function learnVoice(sentBusinessEmails: string[]) {
  return structured({
    schema: VoiceProfile,
    system: `You study how an independent designer writes business email so an assistant can draft in their voice.
Describe their tone in one sentence, their usual length, the greetings and sign-offs they actually use (verbatim), and phrases or habits to avoid because they never appear.`,
    effort: "medium",
    model: modelFor("voice"),
    input: sentBusinessEmails.map((e, i) => `<email n="${i + 1}">\n${e}\n</email>`).join("\n"),
  });
}

export const Draft = z.object({
  subject: z.string(),
  body: z.string(),
  /** Facts the draft relies on, each traceable to the context given. */
  groundedIn: z.array(z.string()),
});
export type Draft = z.infer<typeof Draft>;

export type DraftPurpose = "reply" | "follow_up" | "reconnect" | "coming_up";

const DRAFT_SYSTEM = `You draft short business emails for an independent designer, in their voice.

Rules:
- Use only facts present in the context: past projects, what was said, dates, the reason for writing. Never invent work, results, prices, availability or mutual contacts.
- If the reason for writing is specific (a new role, a launch, last year's project), open with it. Never write a generic "just checking in".
- Match the voice profile's tone, length, greeting and sign-off.
- One clear, low-pressure next step. No sales language.
- List in groundedIn each fact from the context the draft relies on.`;

export function draftEmail(opts: {
  purpose: DraftPurpose;
  voice: VoiceProfile;
  person: Pick<Person, "name">;
  reason: string;
  history: string[];
  studioProfile: string;
}) {
  const { purpose, voice, person, reason, history, studioProfile } = opts;
  return structured({
    schema: Draft,
    system: DRAFT_SYSTEM,
    effort: "high",
    model: modelFor("draft"),
    input: [
      `<studio>\n${studioProfile}\n</studio>`,
      `<voice>\n${JSON.stringify(voice)}\n</voice>`,
      `<recipient>${person.name}</recipient>`,
      `<purpose>${purpose}</purpose>`,
      `<reason>${reason}</reason>`,
      `<history>\n${history.join("\n")}\n</history>`,
    ].join("\n"),
  });
}
