import { z } from "zod";
import { modelFor, structured } from "./client";

/**
 * Industry radar (IR-04 to IR-06). Two passes keep it cheap: a triage pass over
 * titles and short excerpts picks a few posts, then only those are analyzed
 * against the designer's services and the facts Flossamer holds about clients.
 */

export interface RadarArticle {
  id: string;
  source: string;
  title: string;
  excerpt: string;
}

export interface ClientFacts {
  personId: string;
  name: string;
  /** Only facts from the user's own records: company domain, project titles, recent conversation summaries. */
  facts: string[];
}

export const TriageResult = z.object({
  picks: z.array(z.object({ id: z.string(), why: z.string() })),
});

const TRIAGE_SYSTEM = `You screen design and product publications for an independent designer's business assistant.
Pick at most 4 posts that describe a real change (regulation, platform shift, new practice, market move) that could create work for this designer or give them a reason to contact one of their clients.
Skip opinion pieces, tutorials, event roundups, product announcements with no wider effect, and anything only loosely related. Picking nothing is fine.`;

export function triageArticles(opts: { studioContext: string; clientIndustries: string[]; articles: RadarArticle[] }) {
  return structured({
    schema: TriageResult,
    system: TRIAGE_SYSTEM,
    effort: "low",
    model: modelFor("radar"),
    input: [
      `<studio>\n${opts.studioContext}\n</studio>`,
      `<client_domains>${opts.clientIndustries.join(", ")}</client_domains>`,
      `<posts>\n${opts.articles.map((a) => `<post id="${a.id}" source="${a.source}">\n${a.title}\n${a.excerpt.slice(0, 400)}\n</post>`).join("\n")}\n</posts>`,
    ].join("\n"),
  });
}

export const TrendAnalysis = z.object({
  relevant: z.boolean(),
  /** One plain sentence: what's changing, in the designer's terms. */
  trend: z.string(),
  /** Services from the profile this trend creates demand for; empty if none. */
  serviceMatches: z.array(z.string()),
  /** Clients this trend plausibly affects, each tied to a fact from their record. */
  clientMatches: z.array(
    z.object({
      personId: z.string(),
      reason: z.string(),
      basedOn: z.string(),
    }),
  ),
  /** A specific angle the designer could write or talk about, or null. */
  idea: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type TrendAnalysis = z.infer<typeof TrendAnalysis>;

const ANALYZE_SYSTEM = `You connect an industry development to an independent designer's business.

Rules:
- A client match needs a fact from that client's record (their company, a past project, something they said). Quote that fact in basedOn. Never infer a client's industry, plans or problems beyond their record. When unsure, leave the client out.
- serviceMatches may only name services the designer lists in their profile.
- idea is one specific angle the designer could write about or offer, grounded in their services. Null if nothing specific.
- trend and reason are single plain sentences, under 25 words, with no hype.
- relevant is false when the post doesn't describe a change that creates work or a reason to get in touch.`;

export function analyzeArticle(opts: { studioContext: string; clients: ClientFacts[]; article: RadarArticle }) {
  const { article } = opts;
  return structured({
    schema: TrendAnalysis,
    system: ANALYZE_SYSTEM,
    effort: "medium",
    model: modelFor("radar"),
    input: [
      `<studio>\n${opts.studioContext}\n</studio>`,
      `<clients>\n${opts.clients.map((c) => `<client id="${c.personId}" name="${c.name}">\n${c.facts.map((f) => `- ${f}`).join("\n")}\n</client>`).join("\n")}\n</clients>`,
      `<post source="${article.source}">\n${article.title}\n\n${article.excerpt}\n</post>`,
    ].join("\n"),
  });
}
