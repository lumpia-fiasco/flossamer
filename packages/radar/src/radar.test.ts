import { describe, expect, it } from "vitest";
import { disciplinesFor, feedFromNewsletterHeaders, newItems, parseFeed, suggestSources } from "./index";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title><![CDATA[Design Weekly]]></title>
    <item>
      <title><![CDATA[Accessibility rules now enforced in the EU]]></title>
      <link>https://example.com/eaa</link>
      <pubDate>Mon, 21 Sep 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[<p>Retail &amp; banking apps must comply.</p>]]></description>
      <content:encoded><![CDATA[<p>From June, <b>retail</b> and banking apps must meet WCAG&nbsp;2.1 AA.</p>]]></content:encoded>
    </item>
    <item>
      <title>Older post</title>
      <link>https://example.com/old</link>
      <pubDate>Mon, 01 Jun 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Studio Notes</title>
  <entry>
    <title type="html">AI onboarding patterns</title>
    <link rel="alternate" href="https://example.org/ai-onboarding"/>
    <link rel="self" href="https://example.org/ai-onboarding.json"/>
    <published>2026-09-20T12:00:00Z</published>
    <summary type="html">&lt;p&gt;Teams are rebuilding first-run flows.&lt;/p&gt;</summary>
  </entry>
</feed>`;

describe("feeds", () => {
  it("reads RSS, preferring full content and turning HTML into plain text", () => {
    const feed = parseFeed(RSS);
    expect(feed.title).toBe("Design Weekly");
    expect(feed.items[0]).toEqual({
      url: "https://example.com/eaa",
      title: "Accessibility rules now enforced in the EU",
      publishedAt: "2026-09-21T09:00:00.000Z",
      excerpt: "From June, retail and banking apps must meet WCAG 2.1 AA.",
    });
  });

  it("reads Atom, using the alternate link", () => {
    const [item] = parseFeed(ATOM).items;
    expect(item).toMatchObject({ url: "https://example.org/ai-onboarding", title: "AI onboarding patterns", excerpt: "Teams are rebuilding first-run flows." });
  });

  it("rejects anything that isn't a feed", () => {
    expect(() => parseFeed("<html><body>Not a feed</body></html>")).toThrow();
  });

  it("returns only items published since the last fetch, newest first", () => {
    expect(newItems(parseFeed(RSS), "2026-09-01T00:00:00.000Z").map((i) => i.url)).toEqual(["https://example.com/eaa"]);
  });
});

describe("sources", () => {
  it("matches starter sources to the designer's services", () => {
    expect(disciplinesFor("Brand identity and packaging for food startups")).toEqual(expect.arrayContaining(["brand", "product"]));
    const brand = suggestSources("Brand identity, art direction").map((s) => s.title);
    expect(brand).toContain("Design Week");
    expect(brand).not.toContain("Silicon Valley Product Group");
  });

  it("finds a Substack's public feed from newsletter headers, never the body", () => {
    expect(
      feedFromNewsletterHeaders({ listId: "<lenny.substack.com>", listUnsubscribe: null, from: '"Lenny\'s Newsletter" <lenny@substack.com>' }),
    ).toEqual({ url: "https://lenny.substack.com/feed", title: "Lenny's Newsletter" });
    expect(feedFromNewsletterHeaders({ listId: null, listUnsubscribe: null, from: "news@bank.com" })).toBeNull();
  });
});
