import { describe, expect, it } from "vitest";
import {
  SAMPLE_NOW,
  classifyByHeaders,
  composeBriefing,
  detectAll,
  detectJobChanges,
  detectQuietRelationships,
  detectRepeatClientCycles,
  detectSlowSeasons,
  detectThreadSignals,
  sampleAgentSignals,
  sampleInteractions,
  samplePeople,
  sampleProjects,
  type FilterContext,
  type MessageHeaders,
} from "./index";

const sample = {
  now: SAMPLE_NOW,
  people: samplePeople,
  interactions: sampleInteractions,
  projects: sampleProjects,
};

describe("business filter", () => {
  const ctx: FilterContext = {
    exclusions: { senders: ["mom@gmail.com"], domains: ["mybank.com"], labels: ["Label_Family"] },
    knownBusinessContacts: new Set(["maya@northwind.com"]),
    addressesUserWroteTo: new Set(["priya@fieldnote.app", "friend@gmail.com"]),
  };
  const headers = (h: Partial<MessageHeaders>): MessageHeaders => ({
    from: "someone@example.com",
    to: [],
    labels: [],
    listUnsubscribe: false,
    precedence: null,
    autoSubmitted: null,
    ...h,
  });

  it("treats user exclusions as personal, before anything else", () => {
    expect(classifyByHeaders(headers({ from: "Mom <mom@gmail.com>" }), ctx)).toBe("personal");
    expect(classifyByHeaders(headers({ from: "alerts@mybank.com", listUnsubscribe: true }), ctx)).toBe("personal");
    expect(classifyByHeaders(headers({ from: "maya@northwind.com", labels: ["Label_Family"] }), ctx)).toBe("personal");
  });

  it("drops newsletters and notifications as automated", () => {
    expect(classifyByHeaders(headers({ listUnsubscribe: true }), ctx)).toBe("automated");
    expect(classifyByHeaders(headers({ from: "noreply@figma.com" }), ctx)).toBe("automated");
    expect(classifyByHeaders(headers({ labels: ["CATEGORY_PROMOTIONS"] }), ctx)).toBe("automated");
  });

  it("recognizes known and corresponded business contacts", () => {
    expect(classifyByHeaders(headers({ from: "Maya Chen <maya@northwind.com>" }), ctx)).toBe("business");
    expect(classifyByHeaders(headers({ from: "priya@fieldnote.app" }), ctx)).toBe("business");
  });

  it("judges sent mail by its recipient, and never calls it automated", () => {
    const sent = (to: string) => headers({ from: "me@mystudio.com", to: [to], labels: ["SENT"], listUnsubscribe: true });
    expect(classifyByHeaders(sent("jordan@atlas.co"), ctx)).toBe("business");
    expect(classifyByHeaders(sent("mom@gmail.com"), ctx)).toBe("personal");
    expect(classifyByHeaders(sent("friend@gmail.com"), ctx)).toBe("undecided");
  });

  it("leaves consumer-domain senders undecided, even when the user wrote to them", () => {
    expect(classifyByHeaders(headers({ from: "friend@gmail.com" }), ctx)).toBe("undecided");
  });
});

describe("thread signals", () => {
  const signals = detectThreadSignals(sampleInteractions, { now: SAMPLE_NOW });

  it("writes reasons in plain, correctly pluralized English", () => {
    const now = "2026-09-26T16:00:00.000Z"; // Sam wrote a day earlier
    const sam = detectThreadSignals(sampleInteractions, { now }).find((s) => s.personId === "sam");
    expect(sam?.reason).toBe("They wrote 1 day ago and haven't heard back.");
  });

  it("flags a proposal with no reply after 7 days as stalled", () => {
    expect(signals.filter((s) => s.type === "stalled").map((s) => s.personId)).toEqual(["priya"]);
  });

  it("flags recent unanswered inbound mail as waiting, but not old thank-yous", () => {
    const waiting = signals.filter((s) => s.type === "waiting").map((s) => s.personId).sort();
    expect(waiting).toEqual(["sam", "tom"]);
  });
});

describe("quiet relationships", () => {
  it("uses each relationship's own rhythm", () => {
    const quiet = detectQuietRelationships(samplePeople, sampleInteractions, { now: SAMPLE_NOW });
    expect(quiet.map((s) => s.personId).sort()).toEqual(["elena", "maya"]);
  });
});

describe("coming up", () => {
  it("AN-01: spots a client who hires every November", () => {
    const [s, ...rest] = detectRepeatClientCycles(sample);
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({
      personId: "maya",
      comingUpKind: "repeat_client_cycle",
      windowOpens: "2026-11-18",
      reachOutBy: "2026-10-07",
    });
    expect(s!.reason).toContain("Nov 2024 and Nov 2025");
  });

  it("AN-03: spots a past client writing from a new company", () => {
    const [s] = detectJobChanges(sample);
    expect(s).toMatchObject({ personId: "jordan", comingUpKind: "job_change" });
    expect(s!.reason).toContain("atlas.co");
  });

  it("AN-04: spots the user's quiet December with 8+ weeks of lead", () => {
    const [s, ...rest] = detectSlowSeasons(sample);
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({ comingUpKind: "slow_season", windowOpens: "2026-12-01", reachOutBy: "2026-10-06" });
  });

  it("stays silent without two complete years of history", () => {
    const recent = sampleInteractions.filter((i) => i.at >= "2025-01-01");
    expect(detectSlowSeasons({ ...sample, interactions: recent })).toEqual([]);
  });

  it("never emits a signal without evidence", () => {
    for (const s of detectAll(sample)) expect(s.evidence.length).toBeGreaterThan(0);
  });
});

describe("weekly briefing", () => {
  const briefing = composeBriefing([...detectAll(sample), ...sampleAgentSignals], SAMPLE_NOW);

  it("orders Coming up by reach-out date and caps it at 3", () => {
    expect(briefing.comingUp.map((s) => s.comingUpKind)).toEqual(["slow_season", "repeat_client_cycle", "job_change"]);
  });

  it("doesn't double up a person or a thread across sections", () => {
    expect(briefing.reconnects.map((s) => s.personId)).toEqual(["elena"]);
    expect(briefing.waitingOnYou.map((s) => s.personId)).toEqual(["tom"]);
    expect(briefing.newConversations.map((s) => s.personId)).toEqual(["sam"]);
  });

  it("says so when the week is quiet", () => {
    expect(composeBriefing([], SAMPLE_NOW).isQuiet).toBe(true);
    expect(briefing.isQuiet).toBe(false);
  });
});
