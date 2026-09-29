import type { MailClass } from "@flossamer/core";
import { describe, expect, it, vi } from "vitest";
import { backfill, type BackfillStore, type Checkpoint, type MailSource } from "./index";

type Msg = { id: string; from: string; unsubscribe?: boolean };

function memorySource(pages: Msg[][]): MailSource & { bodyReads: string[] } {
  const all = new Map(pages.flat().map((m) => [m.id, m]));
  const bodyReads: string[] = [];
  return {
    bodyReads,
    async list({ pageToken }) {
      const n = pageToken === null ? 0 : Number(pageToken);
      return { refs: pages[n]!.map((m) => ({ id: m.id, threadId: `t-${m.id}` })), nextPageToken: n + 1 < pages.length ? String(n + 1) : null };
    },
    async headers(id) {
      const m = all.get(id)!;
      return { from: m.from, to: [], labels: [], listUnsubscribe: !!m.unsubscribe, precedence: null, autoSubmitted: null, threadId: `t-${id}`, subject: "", snippet: "", date: "", messageId: null };
    },
    async body(id) {
      bodyReads.push(id);
      return `body of ${id}`;
    },
  };
}

function memoryStore(): BackfillStore & { seen: Map<string, MailClass>; saved: Checkpoint | null } {
  const seen = new Map<string, MailClass>();
  const store = {
    seen,
    saved: null as Checkpoint | null,
    async loadCheckpoint() { return store.saved; },
    async saveCheckpoint(c: Checkpoint) { store.saved = c; },
    async hasSeen(id: string) { return seen.has(id); },
    async markSeen(id: string, c: MailClass) { seen.set(id, c); },
  };
  return store;
}

const filter = {
  exclusions: { senders: ["mom@gmail.com"], domains: [], labels: [] },
  knownBusinessContacts: new Set(["maya@northwind.com"]),
  addressesUserWroteTo: new Set<string>(),
};

describe("backfill", () => {
  it("only reads bodies of business mail, and asks the model only about undecided mail", async () => {
    const source = memorySource([
      [{ id: "1", from: "maya@northwind.com" }, { id: "2", from: "mom@gmail.com" }],
      [{ id: "3", from: "news@brand.com", unsubscribe: true }, { id: "4", from: "someone@gmail.com" }],
    ]);
    const store = memoryStore();
    const classifyUndecided = vi.fn(async () => "personal" as const);
    const onBusinessMessage = vi.fn(async () => {});

    const result = await backfill({ source, store, filter, after: "2025-09-27", handlers: { classifyUndecided, onBusinessMessage } });

    expect(result).toEqual({ pageToken: null, processed: 4, done: true });
    expect(source.bodyReads).toEqual(["1"]);
    expect(classifyUndecided).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(store.seen)).toEqual({ "1": "business", "2": "personal", "3": "automated", "4": "personal" });
  });

  it("passes automated mail to the newsletter hook by headers only", async () => {
    const source = memorySource([[{ id: "n1", from: "lenny@substack.com", unsubscribe: true }]]);
    const seen: string[] = [];
    await backfill({
      source, store: memoryStore(), filter, after: "2025-09-27",
      handlers: { classifyUndecided: async () => "personal", onBusinessMessage: async () => {}, onAutomatedMessage: async (ref) => { seen.push(ref.id); } },
    });
    expect(seen).toEqual(["n1"]);
    expect(source.bodyReads).toEqual([]);
  });

  it("resumes from a checkpoint and never reprocesses a message", async () => {
    const source = memorySource([[{ id: "1", from: "maya@northwind.com" }], [{ id: "2", from: "maya@northwind.com" }]]);
    const store = memoryStore();
    store.saved = { pageToken: "1", processed: 1, done: false };
    store.seen.set("1", "business");
    const onBusinessMessage = vi.fn(async () => {});

    await backfill({ source, store, filter, after: "2025-09-27", handlers: { classifyUndecided: async () => "personal", onBusinessMessage } });

    expect(onBusinessMessage).toHaveBeenCalledTimes(1);
    expect(source.bodyReads).toEqual(["2"]);
  });
});
