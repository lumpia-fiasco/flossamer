import { XMLParser } from "fast-xml-parser";

/**
 * RSS 2.0 and Atom reading (IR-03). Substack publications expose RSS at /feed.
 * Only what a feed publishes publicly is read; excerpts are used for triage in
 * memory and never stored beyond a one-line summary.
 */

export interface FeedItem {
  url: string;
  title: string;
  publishedAt: string | null;
  /** Plain text, capped, for triage only. */
  excerpt: string;
}

export interface Feed {
  title: string;
  items: FeedItem[];
}

export const EXCERPT_CHARS = 1200;
const MAX_FEED_BYTES = 5_000_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  processEntities: true,
  htmlEntities: true,
});

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Text content of a node that may be a string, a number, or an object with #text. */
function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return text((v as Record<string, unknown>)["#text"]);
  return "";
}

export function htmlToPlain(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/h\d>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;|&#8217;/g, "'")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const toIso = (v: string) => {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export function parseFeed(xml: string): Feed {
  const doc = parser.parse(xml) as Record<string, any>;

  if (doc.rss?.channel) {
    const channel = doc.rss.channel;
    return {
      title: htmlToPlain(text(channel.title)),
      items: asArray(channel.item)
        .map((i: Record<string, unknown>) => ({
          url: text(i.link).trim() || text(i.guid).trim(),
          title: htmlToPlain(text(i.title)),
          publishedAt: toIso(text(i.pubDate) || text(i["dc:date"])),
          excerpt: htmlToPlain(text(i["content:encoded"]) || text(i.description)).slice(0, EXCERPT_CHARS),
        }))
        .filter((i) => /^https?:\/\//.test(i.url) && i.title),
    };
  }

  if (doc.feed) {
    const feed = doc.feed;
    const linkOf = (entry: Record<string, unknown>) => {
      const links = asArray(entry.link as Record<string, string> | Record<string, string>[]);
      const alt = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0];
      return alt?.["@href"] ?? "";
    };
    return {
      title: htmlToPlain(text(feed.title)),
      items: asArray(feed.entry)
        .map((e: Record<string, unknown>) => ({
          url: linkOf(e),
          title: htmlToPlain(text(e.title)),
          publishedAt: toIso(text(e.published) || text(e.updated)),
          excerpt: htmlToPlain(text(e.content) || text(e.summary)).slice(0, EXCERPT_CHARS),
        }))
        .filter((i) => /^https?:\/\//.test(i.url) && i.title),
    };
  }

  throw new Error("Not an RSS or Atom feed");
}

/** Fetch and parse a public feed, with a timeout and a size cap. */
export async function fetchFeed(url: string, timeoutMs = 15_000): Promise<Feed> {
  if (!/^https?:\/\//.test(url)) throw new Error("Feed URL must start with http:// or https://");
  const res = await fetch(url, {
    headers: { "user-agent": "Flossamer feed reader (+https://flossamer.vercel.app)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Feed returned ${res.status}`);
  const body = await res.text();
  if (body.length > MAX_FEED_BYTES) throw new Error("Feed is too large");
  return parseFeed(body);
}

/** Items published after `since` (or all, when the feed has no dates), newest first. */
export function newItems(feed: Feed, since: string | null, limit = 20): FeedItem[] {
  return feed.items
    .filter((i) => !since || !i.publishedAt || i.publishedAt > since)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, limit);
}
