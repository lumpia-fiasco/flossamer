/**
 * Source suggestions (IR-01, IR-02). The starter list holds publications with
 * public feeds that were checked to work; suggestions are matched to the
 * designer's services, and the user decides what to follow.
 */

export interface StarterSource {
  url: string;
  title: string;
  disciplines: Discipline[];
}

export type Discipline = "product" | "ux" | "research" | "brand" | "web" | "general";

export const STARTER_SOURCES: StarterSource[] = [
  { url: "https://www.nngroup.com/feed/rss/", title: "Nielsen Norman Group", disciplines: ["ux", "research"] },
  { url: "https://uxdesign.cc/feed", title: "UX Collective", disciplines: ["ux", "product"] },
  { url: "https://www.smashingmagazine.com/feed/", title: "Smashing Magazine", disciplines: ["web", "ux"] },
  { url: "https://alistapart.com/main/feed/", title: "A List Apart", disciplines: ["web"] },
  { url: "https://www.lennysnewsletter.com/feed", title: "Lenny's Newsletter", disciplines: ["product"] },
  { url: "https://www.producttalk.org/feed/", title: "Product Talk", disciplines: ["product", "research"] },
  { url: "https://www.svpg.com/feed/", title: "Silicon Valley Product Group", disciplines: ["product"] },
  { url: "https://www.figma.com/blog/feed/atom.xml", title: "Figma Blog", disciplines: ["product", "ux"] },
  { url: "https://uxplanet.org/feed", title: "UX Planet", disciplines: ["ux"] },
  { url: "https://www.fastcompany.com/co-design/rss", title: "Fast Company Co.Design", disciplines: ["brand", "general"] },
  { url: "https://www.designweek.co.uk/feed/", title: "Design Week", disciplines: ["brand"] },
  { url: "https://www.creativebloq.com/feeds/all", title: "Creative Bloq", disciplines: ["brand", "web"] },
  { url: "https://www.dezeen.com/feed/", title: "Dezeen", disciplines: ["brand", "general"] },
];

const KEYWORDS: Record<Discipline, RegExp> = {
  product: /\bproduct\b|saas|startup|app\b|platform|onboarding|growth/i,
  ux: /\bux\b|user experience|interaction|usability|interface|\bui\b|design system/i,
  research: /research|interview|usability test|discovery|insight/i,
  brand: /brand|identity|logo|visual|graphic|packaging|art direct|creative direct/i,
  web: /\bweb\b|website|frontend|front-end|accessib|css/i,
  general: /$^/,
};

/** Disciplines named or implied by the profile; "general" when nothing matches. */
export function disciplinesFor(profileText: string): Discipline[] {
  const found = (Object.keys(KEYWORDS) as Discipline[]).filter((d) => KEYWORDS[d].test(profileText));
  return found.length ? found : ["general", "product", "ux"];
}

/** Starter sources ranked by how many of the designer's disciplines they cover. */
export function suggestSources(profileText: string, limit = 6): StarterSource[] {
  const wanted = new Set(disciplinesFor(profileText));
  return STARTER_SOURCES.map((s) => ({ s, score: s.disciplines.filter((d) => wanted.has(d)).length }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ s }) => s);
}

/**
 * IR-02: from a newsletter's List-Id and List-Unsubscribe headers alone (never its
 * body), guess the publication's public feed. Returns null when there's no safe guess.
 */
export function feedFromNewsletterHeaders(h: { listId: string | null; listUnsubscribe: string | null; from: string }): { url: string; title: string } | null {
  const haystack = [h.listId, h.listUnsubscribe, h.from].filter(Boolean).join(" ");
  const substack = haystack.match(/\b([a-z0-9-]+)\.substack\.com\b/i);
  if (substack && substack[1]!.toLowerCase() !== "email" && substack[1]!.toLowerCase() !== "www") {
    const name = h.from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim();
    return { url: `https://${substack[1]!.toLowerCase()}.substack.com/feed`, title: name || `${substack[1]} (Substack)` };
  }
  return null;
}
