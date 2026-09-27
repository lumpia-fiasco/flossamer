import type { OpportunitySignal } from "@flossamer/core";
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
