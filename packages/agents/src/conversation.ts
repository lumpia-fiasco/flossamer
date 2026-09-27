import { z } from "zod";
import { modelFor, structured } from "./client";

/**
 * Conversation reader: classifies mail the header filter couldn't decide (EM-02),
 * and extracts what a business thread actually says (CN-04, LD-01, AN-02).
 * Message bodies pass through here transiently and are never stored.
 */

export interface ThreadMessage {
  from: string;
  at: string;
  direction: "inbound" | "outbound";
  body: string;
}

const formatThread = (messages: ThreadMessage[]) =>
  messages
    .map((m) => `<message from="${m.from}" at="${m.at}" direction="${m.direction}">\n${m.body}\n</message>`)
    .join("\n");

// ---------------------------------------------------------------------------

export const MailClassification = z.object({
  mailClass: z.enum(["business", "personal", "automated"]),
  confidence: z.number().min(0).max(1),
});

const CLASSIFY_SYSTEM = `You sort email for an independent designer's business assistant.
Decide whether a message is business correspondence (clients, prospects, collaborators, referrals, project work), personal (family, friends, health, finances, private life), or automated (receipts, notifications, newsletters).
When a message mixes personal and business content, or you can't tell, choose "personal": surfacing private mail is far worse than missing a business email.`;

export function classifyMessage(message: { from: string; subject: string; snippet: string }) {
  return structured({
    schema: MailClassification,
    system: CLASSIFY_SYSTEM,
    effort: "low",
    model: modelFor("classify"),
    input: `From: ${message.from}\nSubject: ${message.subject}\n\n${message.snippet}`,
  });
}

// ---------------------------------------------------------------------------

/** A value that is either stated in the thread (with the exact quote) or null. */
const stated = z
  .object({ value: z.string(), quote: z.string() })
  .nullable();

export const ThreadExtraction = z.object({
  kind: z.enum(["inquiry", "intro", "project_work", "other"]),
  needsReplyFromUser: z.boolean(),
  service: stated,
  projectDescription: stated,
  budget: stated,
  timeline: stated,
  referrer: stated,
  /** AN-02: "let's revisit after Q1", "once funding closes". */
  deferredIntent: z
    .object({
      quote: z.string(),
      /** ISO date the thread points to, only if the text supports one. */
      revisitAround: z.string().nullable(),
    })
    .nullable(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ThreadExtraction = z.infer<typeof ThreadExtraction>;

const EXTRACT_SYSTEM = `You read business email threads for an independent designer and extract what was actually said.

Rules:
- A field is filled only when the thread states it. Include the exact quote it came from. Otherwise the field is null. Never estimate a budget, timeline or service from context.
- "inquiry" means someone is asking about hiring the designer. "intro" means a third party is connecting the designer with someone. "project_work" is correspondence about work already underway.
- deferredIntent captures an explicit plan to pick things up later ("let's revisit in Q1", "after our funding closes"). Set revisitAround to a date only when the words imply one, resolved against the date of that message.
- summary is one plain sentence, under 20 words, with no names of third parties who aren't in the thread.`;

export function extractThread(messages: ThreadMessage[], studioContext: string) {
  return structured({
    schema: ThreadExtraction,
    system: EXTRACT_SYSTEM,
    effort: "medium",
    model: modelFor("extract"),
    input: `<studio>\n${studioContext}\n</studio>\n<thread>\n${formatThread(messages)}\n</thread>`,
  });
}
