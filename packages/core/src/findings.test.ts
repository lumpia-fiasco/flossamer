import { describe, expect, it } from "vitest";
import {
  SAMPLE_NOW,
  composeFindings,
  detectAll,
  gateZeroOutcome,
  sampleAgentSignals,
  sampleInteractions,
  samplePeople,
  sampleProjects,
} from "./index";

const signals = [
  ...detectAll({ now: SAMPLE_NOW, people: samplePeople, interactions: sampleInteractions, projects: sampleProjects }),
  ...sampleAgentSignals,
];
const report = composeFindings({
  now: SAMPLE_NOW,
  people: samplePeople,
  interactions: sampleInteractions,
  projects: sampleProjects,
  signals,
  mail: { business: 120, personal: 840, automated: 3100 },
});

describe("findings report", () => {
  it("leads with the numbers, including what was set aside unread", () => {
    expect(report.totals).toMatchObject({
      businessMessages: 120,
      people: 6,
      clients: 3,
      paidProjects: 2,
      setAsidePersonal: 840,
      setAsideAutomated: 3100,
    });
    expect(report.periodStart).toBe("2024-01-08T15:00:00.000Z");
  });

  it("orders sections by urgency and drops empty ones", () => {
    // Sam's inquiry is the top pick, so "New conversations" is empty and left out.
    expect(report.sections.map((s) => s.key)).toEqual(["waiting", "follow_up", "coming_up", "reconnect"]);
  });

  it("lists each person once: the top pick and inquiries aren't repeated elsewhere", () => {
    const names = report.sections.flatMap((s) => s.items.map((i) => i.personName)).concat(report.topPick!.personName);
    expect(names.filter((n) => n === "Sam Okafor")).toHaveLength(1);
    expect(report.sections.find((s) => s.key === "waiting")!.items.map((i) => i.personName)).toEqual(["Tom Alvarez"]);
  });

  it("doesn't list someone as a generic reconnect when there's a timed reason", () => {
    const reconnect = report.sections.find((s) => s.key === "reconnect")!;
    expect(reconnect.items.map((i) => i.personName)).toEqual(["Elena Ruiz"]);
  });

  it("puts an unanswered inquiry at the top, ahead of timed moments", () => {
    expect(report.topPick).toMatchObject({ personName: "Sam Okafor" });
  });

  it("falls back to the most urgent timed moment when there's no inquiry", () => {
    const noInquiry = signals.filter((s) => s.type !== "inquiry");
    const r = composeFindings({ now: SAMPLE_NOW, people: samplePeople, interactions: sampleInteractions, projects: sampleProjects, signals: noInquiry, mail: { business: 0, personal: 0, automated: 0 } });
    expect(r.topPick).toMatchObject({ personName: "Jordan Blake" });
  });

  it("leaves out anything the user already dealt with", () => {
    const handled = signals.map((s) => (s.personId === "priya" ? { ...s, status: "done" as const } : s));
    const again = composeFindings({ now: SAMPLE_NOW, people: samplePeople, interactions: sampleInteractions, projects: sampleProjects, signals: handled, mail: { business: 0, personal: 0, automated: 0 } });
    expect(again.sections.find((s) => s.key === "follow_up")).toBeUndefined();
  });
});

describe("Gate 0 outcome", () => {
  const viewed = "2026-09-28T10:00:00.000Z";
  it("counts an action within 7 days of first viewing", () => {
    expect(gateZeroOutcome({ firstViewedAt: viewed, actionsAt: ["2026-10-02T09:00:00.000Z"], now: "2026-10-10T00:00:00.000Z" }).status).toBe("acted");
  });
  it("ignores actions before viewing or after the week", () => {
    const r = gateZeroOutcome({ firstViewedAt: viewed, actionsAt: ["2026-09-27T09:00:00.000Z", "2026-10-06T09:00:00.000Z"], now: "2026-10-10T00:00:00.000Z" });
    expect(r.status).toBe("no_action");
  });
  it("reports days left while the week is running", () => {
    expect(gateZeroOutcome({ firstViewedAt: viewed, actionsAt: [], now: "2026-09-30T10:00:00.000Z" })).toMatchObject({ status: "waiting", daysLeft: 5 });
  });
  it("knows when the report hasn't been opened", () => {
    expect(gateZeroOutcome({ firstViewedAt: null, actionsAt: [], now: viewed }).status).toBe("not_viewed");
  });
});
