import { companyChanged, type OpportunitySignal } from "@flossamer/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./client";
import * as repo from "./repo";
import { testDb } from "./testing";

let db: Db;
let a: string;
let b: string;

const signal = (id: string, personId: string | null, extra: Partial<OpportunitySignal> = {}): OpportunitySignal => ({
  id,
  type: "stalled",
  comingUpKind: null,
  personId,
  evidence: ["m1"],
  reason: "No reply in 9 days.",
  confidence: 0.9,
  windowOpens: null,
  reachOutBy: null,
  status: "open",
  createdAt: new Date().toISOString(),
  ...extra,
});

beforeEach(async () => {
  db = await testDb();
  a = (await repo.upsertStudioForGoogle(db, { sub: "google-a", email: "a@studio-a.com", name: "A" })).id;
  b = (await repo.upsertStudioForGoogle(db, { sub: "google-b", email: "b@studio-b.com", name: "B" })).id;
});

describe("sign-in", () => {
  it("returns the same studio for the same Google account", async () => {
    const again = await repo.upsertStudioForGoogle(db, { sub: "google-a", email: "a@new-address.com", name: "A" });
    expect(again.id).toBe(a);
    expect((await repo.getStudio(db, a)).owner_email).toBe("a@new-address.com");
  });
});

describe("people", () => {
  it("resolves an address to one person, with a name and an organization", async () => {
    const first = await repo.resolvePerson(db, a, '"Maya Chen" <Maya@Northwind.com>');
    const second = await repo.resolvePerson(db, a, "maya@northwind.com");
    expect(second).toBe(first);
    const [maya] = await repo.listPeople(db, a);
    expect(maya).toMatchObject({ name: "Maya Chen", emails: ["maya@northwind.com"], confirmed: false });
    expect(maya!.organizationIds).toHaveLength(1);
  });

  it("gives consumer-domain contacts no organization", async () => {
    await repo.resolvePerson(db, a, "sam.okafor@gmail.com");
    const [sam] = await repo.listPeople(db, a);
    expect(sam).toMatchObject({ name: "Sam Okafor", organizationIds: [] });
  });

  it("never lets an agent overwrite what the user entered", async () => {
    const id = await repo.resolvePerson(db, a, "maya@northwind.com");
    await repo.setRelationship(db, a, id, "past_client");
    await repo.suggestRelationship(db, a, id, "prospect", "m9", 0.6);
    const [maya] = await repo.listPeople(db, a);
    expect(maya!.relationship.value).toBe("past_client");
  });
});

describe("signals", () => {
  it("keeps the user's decision when a detector refreshes a signal", async () => {
    await repo.upsertSignals(db, a, [signal("stalled:t1", null)]);
    await repo.setSignalStatus(db, a, "stalled:t1", "snoozed", { snoozedUntil: "2026-10-04" });
    await repo.upsertSignals(db, a, [signal("stalled:t1", null, { reason: "No reply in 12 days." })]);
    const [s] = await repo.listSignals(db, a);
    expect(s).toMatchObject({ status: "snoozed", reason: "No reply in 12 days." });
  });

  it("reopens snoozes on their date", async () => {
    await repo.upsertSignals(db, a, [signal("stalled:t1", null)]);
    await repo.setSignalStatus(db, a, "stalled:t1", "snoozed", { snoozedUntil: "2026-10-04" });
    await repo.reopenExpiredSnoozes(db, a, "2026-10-03");
    expect((await repo.getSignal(db, a, "stalled:t1"))!.status).toBe("snoozed");
    await repo.reopenExpiredSnoozes(db, a, "2026-10-04");
    expect((await repo.getSignal(db, a, "stalled:t1"))!.status).toBe("open");
  });

  it("round-trips dates as plain YYYY-MM-DD", async () => {
    await repo.upsertSignals(db, a, [signal("coming_up:x", null, { type: "coming_up", comingUpKind: "slow_season", windowOpens: "2026-12-01", reachOutBy: "2026-10-06" })]);
    expect(await repo.getSignal(db, a, "coming_up:x")).toMatchObject({ windowOpens: "2026-12-01", reachOutBy: "2026-10-06" });
  });
});

describe("studio isolation", () => {
  it("never shows one studio's data to another", async () => {
    const maya = await repo.resolvePerson(db, a, "maya@northwind.com");
    await repo.insertInteraction(db, a, {
      id: "m1", threadId: "t1", at: "2026-09-01T10:00:00Z", direction: "inbound", counterpart: "maya@northwind.com",
      counterpartName: "Maya", personId: maya, subject: "Hello", summary: "Hello", expectsReply: false,
    });
    await repo.upsertSignals(db, a, [signal("stalled:t1", maya)]);
    await repo.createProject(db, a, { title: "Checkout", stage: "Booked", originSignalId: null, personId: maya, threadIds: ["t1"] });

    expect(await repo.listPeople(db, b)).toEqual([]);
    expect(await repo.listInteractions(db, b)).toEqual([]);
    expect(await repo.listSignals(db, b)).toEqual([]);
    expect(await repo.listProjects(db, b)).toEqual([]);
    expect(await repo.interactionsByIds(db, b, ["m1"])).toEqual([]);
    expect(await repo.getSignal(db, b, "stalled:t1")).toBeNull();
    expect(await repo.personEmails(db, b, maya)).toEqual([]);
  });

  it("ignores writes that name another studio's rows", async () => {
    const maya = await repo.resolvePerson(db, a, "maya@northwind.com");
    await repo.upsertSignals(db, a, [signal("stalled:t1", maya)]);

    await repo.setSignalStatus(db, b, "stalled:t1", "wrong");
    await repo.setRelationship(db, b, maya, "client");
    await repo.deletePersonAndMail(db, b, maya);
    expect((await repo.getSignal(db, a, "stalled:t1"))!.status).toBe("open");
    expect((await repo.listPeople(db, a))[0]).toMatchObject({ confirmed: false });

    // Studio B can't attach A's person to its own project, signal or message.
    await repo.createProject(db, b, { title: "Theirs", stage: "Booked", originSignalId: null, personId: maya, threadIds: [] });
    expect((await repo.listProjects(db, b))[0]!.personIds).toEqual([]);
    await repo.upsertSignals(db, b, [signal("reconnect:x", maya)]);
    expect((await repo.getSignal(db, b, "reconnect:x"))!.personId).toBeNull();
    await repo.insertInteraction(db, b, {
      id: "m2", threadId: "t2", at: "2026-09-01T10:00:00Z", direction: "inbound", counterpart: "maya@northwind.com",
      counterpartName: null, personId: maya, subject: "", summary: "", expectsReply: false,
    });
    expect(await repo.listInteractions(db, b)).toEqual([]);
  });

  it("keeps OAuth secrets per studio and out of exports", async () => {
    const integration = await repo.upsertGmailIntegration(db, a, "a@studio-a.com", ["gmail.readonly"]);
    await repo.saveSecret(db, a, integration.id, "encrypted-token");
    await repo.saveSecret(db, b, integration.id, "hijack");

    expect(await repo.getSecret(db, a, integration.id)).toBe("encrypted-token");
    await expect(repo.getSecret(db, b, integration.id)).rejects.toThrow();
    await expect(repo.getIntegrationForStudio(db, b, integration.id)).rejects.toThrow();
    expect(JSON.stringify(await repo.exportStudio(db, a))).not.toContain("encrypted-token");
  });

  it("purges only the matching studio's mail on exclusion", async () => {
    for (const studio of [a, b]) {
      const id = await repo.resolvePerson(db, studio, "mom@family.net");
      await repo.insertInteraction(db, studio, {
        id: `m-${studio}`, threadId: "t", at: "2026-09-01T10:00:00Z", direction: "inbound", counterpart: "mom@family.net",
        counterpartName: null, personId: id, subject: "", summary: "", expectsReply: false,
      });
    }
    await repo.purgeMatching(db, a, "%@family.net");
    expect(await repo.listPeople(db, a)).toEqual([]);
    expect(await repo.listInteractions(db, a)).toEqual([]);
    expect(await repo.listPeople(db, b)).toHaveLength(1);
    expect(await repo.listInteractions(db, b)).toHaveLength(1);
  });

  it("deletes a studio's data and nothing else", async () => {
    await repo.resolvePerson(db, a, "maya@northwind.com");
    await repo.resolvePerson(db, b, "maya@northwind.com");
    await repo.deleteStudio(db, a);
    expect(await repo.listPeople(db, a)).toEqual([]);
    expect(await repo.listPeople(db, b)).toHaveLength(1);
  });
});

describe("findings report data", () => {
  it("counts mail by class, per studio", async () => {
    await repo.markSeen(db, a, "m1", "business");
    await repo.markSeen(db, a, "m2", "personal");
    await repo.markSeen(db, a, "m3", "personal");
    await repo.markSeen(db, b, "m4", "automated");
    expect(await repo.mailClassCounts(db, a)).toEqual({ business: 1, personal: 2, automated: 0 });
  });

  it("records only the first report view, and collects acting events", async () => {
    await repo.recordReportView(db, a);
    const first = (await repo.gateZeroEvents(db, a)).firstViewedAt;
    await repo.recordReportView(db, a);
    expect((await repo.gateZeroEvents(db, a)).firstViewedAt).toBe(first);

    await repo.logAction(db, a, { agent: "user", trigger: "snooze", proposed: {}, approval: "approved" });
    await repo.logAction(db, a, { agent: "draft_writer", trigger: "draft:reconnect", proposed: {}, approval: "pending" });
    await repo.logAction(db, a, { agent: "user", trigger: "create_project", proposed: {}, approval: "approved" });
    const events = await repo.gateZeroEvents(db, a);
    expect(events.actionsAt).toHaveLength(2); // snoozing isn't acting
    expect((await repo.gateZeroEvents(db, b)).firstViewedAt).toBeNull();
  });
});

describe("industry radar", () => {
  it("keeps sources and posts per studio", async () => {
    const src = await repo.addSource(db, a, { url: "https://example.com/feed", title: "Example", origin: "user", enabled: true });
    await repo.addSource(db, b, { url: "https://example.com/feed", title: "Example", origin: "user", enabled: true });

    const fresh = await repo.insertArticles(db, a, src, [{ url: "https://example.com/p1", title: "Post", publishedAt: "2026-09-20T00:00:00Z" }]);
    expect(fresh).toHaveLength(1);
    expect(await repo.insertArticles(db, a, src, [{ url: "https://example.com/p1", title: "Post", publishedAt: null }])).toEqual([]);

    // B can't write posts into A's source, or switch it off.
    expect(await repo.insertArticles(db, b, src, [{ url: "https://example.com/p2", title: "Other", publishedAt: null }])).toEqual([]);
    await repo.setSourceEnabled(db, b, src, false);
    expect((await repo.listSources(db, a))[0]!.enabled).toBe(true);
    await repo.removeSource(db, b, src);
    expect(await repo.listSources(db, a)).toHaveLength(1);
  });

  it("never switches a source off by re-adding it", async () => {
    const src = await repo.addSource(db, a, { url: "https://x.substack.com/feed", title: "X", origin: "user", enabled: true });
    await repo.addSource(db, a, { url: "https://x.substack.com/feed", title: "X", origin: "newsletter", enabled: false });
    expect((await repo.listSources(db, a)).find((s) => s.id === src)!.enabled).toBe(true);
  });

  it("only offers the radar studios with a source switched on", async () => {
    await repo.addSource(db, a, { url: "https://example.com/feed", title: "Example", origin: "user", enabled: true });
    await repo.addSource(db, b, { url: "https://example.com/feed", title: "Example", origin: "newsletter", enabled: false });
    expect(await repo.studiosForRadar(db)).toEqual([a]);
  });

  it("gives the analysis only confirmed clients, with facts from the user's records", async () => {
    const maya = await repo.resolvePerson(db, a, "maya@northwind.com");
    await repo.resolvePerson(db, a, "stranger@unknown.com");
    await repo.setRelationship(db, a, maya, "past_client");
    await repo.createProject(db, a, { title: "Checkout redesign", stage: "Wrapped", originSignalId: null, personId: maya, threadIds: [] });
    const facts = await repo.clientFacts(db, a);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.facts).toEqual(expect.arrayContaining(["Relationship: past client", "Email domain: northwind.com", "Project together: Checkout redesign"]));
    expect(await repo.clientFacts(db, b)).toEqual([]);
  });

  it("stores the source link on radar signals and counts them for the weekly cap", async () => {
    await repo.upsertSignals(db, a, [
      signal("idea:1", null, { type: "idea", link: { url: "https://example.com/p1", title: "Post", source: "Example" } }),
    ]);
    expect((await repo.getSignal(db, a, "idea:1"))!.link).toEqual({ url: "https://example.com/p1", title: "Post", source: "Example" });
    expect(await repo.radarSignalCount(db, a, "2000-01-01")).toBe(1);
    expect(await repo.radarSignalCount(db, b, "2000-01-01")).toBe(0);
  });
});

describe("LinkedIn", () => {
  const conn = (company: string, extra: Partial<{ email: string | null; position: string }> = {}) => ({
    profileUrl: "https://www.linkedin.com/in/mayachen",
    firstName: "Maya",
    lastName: "Chen",
    email: extra.email ?? null,
    company,
    position: extra.position ?? "Director of Design",
    connectedOn: "2024-09-15",
  });

  it("detects a job change on re-import, for people matched by email", async () => {
    const maya = await repo.resolvePerson(db, a, "maya@northwind.com");
    const first = await repo.importLinkedIn(db, a, [conn("Northwind", { email: "maya@northwind.com" })], [{ profileUrl: conn("").profileUrl, personId: maya, how: "email" }], companyChanged);
    expect(first).toMatchObject({ total: 1, added: 1, matchedByEmail: 1, changes: [] });

    const second = await repo.importLinkedIn(db, a, [conn("Atlas", { position: "Head of Design" })], [], companyChanged);
    expect(second.changes).toEqual([
      { personId: maya, name: "Maya Chen", before: "Director of Design at Northwind", after: "Head of Design at Atlas", company: "Atlas" },
    ]);
    // The email match survives an import that didn't re-match it.
    expect((await repo.linkedInByPerson(db, a)).get(maya)).toMatchObject({ company: "Atlas", previous_company: "Northwind", match: "email" });
  });

  it("keeps name matches as suggestions until the user confirms", async () => {
    const maya = await repo.resolvePerson(db, a, "maya@northwind.com");
    await repo.importLinkedIn(db, a, [conn("Northwind")], [{ profileUrl: conn("").profileUrl, personId: maya, how: "name" }], companyChanged);
    expect((await repo.linkedInByPerson(db, a)).size).toBe(0);
    expect(await repo.suggestedLinkedInMatches(db, a)).toHaveLength(1);

    await repo.resolveLinkedInMatch(db, a, conn("").profileUrl, true);
    expect((await repo.linkedInByPerson(db, a)).get(maya)?.match).toBe("confirmed");
    expect(await repo.suggestedLinkedInMatches(db, a)).toHaveLength(0);
  });

  it("never links another studio's person, and keeps connections per studio", async () => {
    const maya = await repo.resolvePerson(db, a, "maya@northwind.com");
    await repo.importLinkedIn(db, b, [conn("Northwind")], [{ profileUrl: conn("").profileUrl, personId: maya, how: "email" }], companyChanged);
    expect((await repo.linkedInByPerson(db, b)).size).toBe(0);
    expect(await repo.connectionsAt(db, a, "Northwind", null)).toEqual([]);
    expect(await repo.connectionsAt(db, b, "northwind", null)).toHaveLength(1);

    await repo.addLinkedInEvent(db, b, { personId: maya, kind: "post", text: "x", at: "2026-09-01T00:00:00Z", messageId: "m1" });
    expect(await repo.listLinkedInEvents(db, a, maya)).toEqual([]);
  });

  it("records LinkedIn events once and adds them to what the radar knows", async () => {
    const maya = await repo.resolvePerson(db, a, "maya@northwind.com");
    await repo.setRelationship(db, a, maya, "past_client");
    const post = { personId: maya, kind: "post" as const, text: "What we learned redesigning checkout", at: "2026-09-20T00:00:00Z", messageId: "li-1" };
    await repo.addLinkedInEvent(db, a, post);
    await repo.addLinkedInEvent(db, a, post);
    expect(await repo.listLinkedInEvents(db, a, maya)).toHaveLength(1);
    expect((await repo.clientFacts(db, a))[0]!.facts).toContain("Recently posted on LinkedIn: What we learned redesigning checkout");
  });
});
