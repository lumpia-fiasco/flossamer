import { analyzeArticle, triageArticles, type RadarArticle } from "@flossamer/agents";
import { addDays, isoDay, type OpportunitySignal } from "@flossamer/core";
import * as repo from "@flossamer/db";
import { fetchFeed, newItems } from "@flossamer/radar";
import { db } from "@/lib/db";

/**
 * Industry radar job (IR-03 to IR-07). Article text lives only in memory for
 * the length of this run; what's stored is the link, title and one line.
 */

/** IR-07: at most this many radar items per rolling week. */
export const RADAR_WEEKLY_CAP = 3;
const FIRST_RUN_LOOKBACK_DAYS = 7;
const MAX_POSTS_PER_SOURCE = 10;
const MIN_CONFIDENCE = 0.6;

export async function runRadar(studioId: string): Promise<{ fetched: number; picked: number; created: number }> {
  const conn = db();
  const now = new Date().toISOString();
  const studio = await repo.getStudio(conn, studioId);
  if (!studio.radar_enabled) return { fetched: 0, picked: 0, created: 0 };

  // 1. Fetch new public posts from each enabled source.
  const posts = new Map<string, RadarArticle & { url: string; sourceTitle: string }>();
  for (const source of (await repo.listSources(conn, studioId)).filter((s) => s.enabled)) {
    try {
      const feed = await fetchFeed(source.url);
      const since = source.last_fetched_at ?? addDays(now, -FIRST_RUN_LOOKBACK_DAYS);
      const items = newItems(feed, since, MAX_POSTS_PER_SOURCE);
      const fresh = await repo.insertArticles(conn, studioId, source.id, items);
      const byUrl = new Map(items.map((i) => [i.url, i]));
      for (const { id, url } of fresh) {
        const item = byUrl.get(url)!;
        posts.set(id, { id, url, source: source.title, sourceTitle: source.title, title: item.title, excerpt: item.excerpt });
      }
      await repo.markSourceFetched(conn, studioId, source.id, null);
    } catch (e) {
      await repo.markSourceFetched(conn, studioId, source.id, (e as Error).message.slice(0, 200));
    }
  }
  if (posts.size === 0) return { fetched: 0, picked: 0, created: 0 };

  // 2. Respect the weekly cap before spending anything on analysis.
  const remaining = RADAR_WEEKLY_CAP - (await repo.radarSignalCount(conn, studioId, addDays(now, -7)));
  if (remaining <= 0) {
    for (const id of posts.keys()) await repo.setArticleTriage(conn, studioId, id, "skipped");
    return { fetched: posts.size, picked: 0, created: 0 };
  }

  // 3. Triage on titles and short excerpts.
  const context = repo.studioContext(studio);
  const clients = await repo.clientFacts(conn, studioId);
  const clientDomains = [...new Set(clients.flatMap((c) => c.facts.filter((f) => f.startsWith("Email domain:")).map((f) => f.slice(14))))];
  const { picks } = await triageArticles({ studioContext: context, clientIndustries: clientDomains, articles: [...posts.values()] });
  const picked = picks.map((p) => p.id).filter((id) => posts.has(id));
  for (const id of posts.keys()) if (!picked.includes(id)) await repo.setArticleTriage(conn, studioId, id, "skipped");

  // 4. Read the picks against the profile and client facts.
  const known = new Set(clients.map((c) => c.personId));
  const candidates: OpportunitySignal[] = [];
  for (const id of picked) {
    const post = posts.get(id)!;
    await repo.setArticleTriage(conn, studioId, id, "picked");
    let analysis;
    try {
      analysis = await analyzeArticle({ studioContext: context, clients, article: post });
    } catch {
      continue;
    }
    await repo.setArticleTriage(conn, studioId, id, "analyzed", analysis.relevant ? analysis.trend : null);
    if (!analysis.relevant || analysis.confidence < MIN_CONFIDENCE) continue;

    const link = { url: post.url, title: post.title, source: post.sourceTitle };
    const base = { evidence: [`article:${id}`], status: "open" as const, createdAt: now, link, confidence: analysis.confidence };

    // IR-05: trend x clients. Only people Flossamer actually holds facts for.
    const matches = analysis.clientMatches.filter((m) => known.has(m.personId)).slice(0, 2);
    for (const m of matches) {
      candidates.push({
        ...base,
        id: `coming_up:trend:${id}:${m.personId}`,
        type: "coming_up",
        comingUpKind: "industry_trend",
        personId: m.personId,
        reason: `${analysis.trend} ${m.reason}`,
        windowOpens: null,
        reachOutBy: isoDay(addDays(now, 14)),
      });
    }
    // IR-06: trend x services, when no client match made it concrete.
    if (matches.length === 0 && analysis.serviceMatches.length > 0 && analysis.idea) {
      candidates.push({
        ...base,
        id: `idea:${id}`,
        type: "idea",
        comingUpKind: null,
        personId: null,
        reason: `${analysis.trend} ${analysis.idea}`,
        windowOpens: null,
        reachOutBy: null,
      });
    }
  }

  // Client matches first: they're the part only Flossamer can do.
  const chosen = candidates
    .sort((a, b) => Number(b.type === "coming_up") - Number(a.type === "coming_up") || b.confidence - a.confidence)
    .slice(0, remaining);
  await repo.upsertSignals(conn, studioId, chosen);
  return { fetched: posts.size, picked: picked.length, created: chosen.length };
}
