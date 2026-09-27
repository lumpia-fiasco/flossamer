import { addDays, daysBetween, isoDay, toMs } from "./dates";
import { CONSUMER_DOMAINS, domainOf } from "./filter";
import { makeSignal } from "./signals";
import type { Interaction, OpportunitySignal, Person, Project } from "./types";

/**
 * Coming up: anticipatory opportunities from the user's own history
 * (AN-01 repeat-client cycles, AN-03 job changes, AN-04 slow seasons).
 * AN-02 deferred intent needs language understanding and lives in @flossamer/agents.
 *
 * Every item carries its timing: when the window opens and when to reach out.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** Weeks of lead time we want before a window opens. */
const REACH_OUT_LEAD_DAYS = 42;
/** How early an item may appear in the briefing. */
const SURFACE_LEAD_DAYS = 70;

interface ComingUpInput {
  now: string;
  people: Person[];
  interactions: Interaction[];
  projects: Project[];
}

/** Day-of-year distance on a circular calendar. */
function seasonalDistance(a: string, b: string): number {
  const doy = (iso: string) => {
    const d = new Date(iso);
    return (Date.UTC(2001, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(2001, 0, 1)) / 86_400_000;
  };
  const diff = Math.abs(doy(a) - doy(b));
  return Math.min(diff, 365 - diff);
}

/** The first anniversary of `iso` that falls after `now`. */
function nextAnniversary(iso: string, now: string): string {
  const d = new Date(iso);
  let year = new Date(now).getUTCFullYear();
  let candidate = new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate())).toISOString();
  if (candidate <= now) {
    year += 1;
    candidate = new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate())).toISOString();
  }
  return candidate;
}

function inSurfaceWindow(now: string, windowOpens: string): boolean {
  const lead = daysBetween(now, windowOpens);
  return lead > 0 && lead <= SURFACE_LEAD_DAYS;
}

function timing(now: string, windowOpens: string) {
  const reachOutBy = addDays(windowOpens, -REACH_OUT_LEAD_DAYS);
  return {
    windowOpens: isoDay(windowOpens),
    reachOutBy: isoDay(reachOutBy < now ? now : reachOutBy),
  };
}

/** AN-01: clients who hired the user around the same time in more than one year. */
export function detectRepeatClientCycles({ now, interactions, projects }: ComingUpInput): OpportunitySignal[] {
  const firstInThread = new Map<string, Interaction>();
  for (const i of [...interactions].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!firstInThread.has(i.threadId)) firstInThread.set(i.threadId, i);
  }

  const startsByPerson = new Map<string, { start: string; evidence: string }[]>();
  for (const p of projects) {
    const origin = p.threadIds.map((t) => firstInThread.get(t)).find(Boolean);
    const start = p.expectedStart ?? origin?.at;
    if (!start || !origin) continue;
    for (const personId of p.personIds) {
      const list = startsByPerson.get(personId) ?? [];
      list.push({ start, evidence: origin.id });
      startsByPerson.set(personId, list);
    }
  }

  const out: OpportunitySignal[] = [];
  for (const [personId, starts] of startsByPerson) {
    starts.sort((a, b) => a.start.localeCompare(b.start));
    const latest = starts.at(-1)!;
    const cycle = starts.filter(
      (s) => s.start.slice(0, 4) !== latest.start.slice(0, 4) && seasonalDistance(s.start, latest.start) <= 45,
    );
    if (cycle.length === 0) continue;

    const matched = [...cycle, latest];
    const windowOpens = nextAnniversary(matched[0]!.start, now);
    if (!inSurfaceWindow(now, windowOpens)) continue;

    out.push(
      makeSignal(
        {
          id: `coming_up:repeat:${personId}:${windowOpens.slice(0, 4)}`,
          type: "coming_up",
          comingUpKind: "repeat_client_cycle",
          personId,
          evidence: matched.map((s) => s.evidence),
          reason: `Hired you in ${matched.map((s) => monthYear(s.start)).join(" and ")}. Their next project may start around ${monthYear(windowOpens)}.`,
          confidence: matched.length >= 3 ? 0.75 : 0.55,
          ...timing(now, windowOpens),
        },
        now,
      ),
    );
  }
  return out;
}

/** AN-03: a known contact now writing from a different company domain. */
export function detectJobChanges({ now, people, interactions }: ComingUpInput): OpportunitySignal[] {
  const out: OpportunitySignal[] = [];
  for (const person of people) {
    if (!person.confirmed) continue;
    const inbound = interactions
      .filter((i) => i.personId === person.id && i.direction === "inbound")
      .sort((a, b) => a.at.localeCompare(b.at));
    const latest = inbound.at(-1);
    const previous = inbound.at(-2);
    if (!latest || !previous || daysBetween(latest.at, now) > 60) continue;

    const before = domainOf(previous.counterpart);
    const after = domainOf(latest.counterpart);
    if (before === after || CONSUMER_DOMAINS.has(before) || CONSUMER_DOMAINS.has(after)) continue;

    out.push(
      makeSignal(
        {
          id: `coming_up:job:${person.id}:${after}`,
          type: "coming_up",
          comingUpKind: "job_change",
          personId: person.id,
          evidence: [previous.id, latest.id],
          reason: `${person.name} now writes from ${after} (was ${before}). A new role is often a chance to bring in trusted people.`,
          confidence: 0.6,
          // The window is already open: the new role just started.
          reachOutBy: isoDay(addDays(now, 14)),
        },
        now,
      ),
    );
  }
  return out;
}

/**
 * AN-04: calendar months that were quiet for the user in at least two years.
 * "Quiet" = new inbound business threads at or below half that year's monthly average.
 */
export function detectSlowSeasons({ now, interactions }: ComingUpInput): OpportunitySignal[] {
  const threadStarts = new Map<string, Interaction>();
  for (const i of [...interactions].sort((a, b) => a.at.localeCompare(b.at))) {
    if (i.mailClass === "business" && !threadStarts.has(i.threadId)) threadStarts.set(i.threadId, i);
  }
  const newInbound = [...threadStarts.values()].filter((i) => i.direction === "inbound" && i.at < now);

  const counts = new Map<string, number>(); // "YYYY-MM" -> count
  const years = new Set<string>();
  for (const i of newInbound) {
    counts.set(i.at.slice(0, 7), (counts.get(i.at.slice(0, 7)) ?? 0) + 1);
    years.add(i.at.slice(0, 4));
  }

  // Only judge complete years, so a partial current year doesn't look slow.
  const currentYear = now.slice(0, 4);
  const fullYears = [...years].filter((y) => y < currentYear);
  if (fullYears.length < 2) return [];

  const out: OpportunitySignal[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    const slowYears = fullYears.filter((y) => {
      const total = Array.from({ length: 12 }, (_, k) => counts.get(`${y}-${String(k + 1).padStart(2, "0")}`) ?? 0)
        .reduce((a, b) => a + b, 0);
      return (counts.get(`${y}-${mm}`) ?? 0) <= (total / 12) * 0.5;
    });
    if (slowYears.length < 2) continue;

    const windowOpens = nextAnniversary(`${currentYear}-${mm}-01T00:00:00.000Z`, now);
    // Slow seasons need a longer runway than one client: surface up to 12 weeks out.
    const lead = daysBetween(now, windowOpens);
    if (lead <= 0 || lead > 84) continue;

    // Evidence: the last new inquiry before each slow month, so the user can see the gap.
    const evidence = slowYears
      .map((y) => newInbound.filter((i) => toMs(i.at) < Date.parse(`${y}-${mm}-01`)).at(-1)?.id)
      .filter((id): id is string => Boolean(id));
    if (evidence.length === 0) continue;

    out.push(
      makeSignal(
        {
          id: `coming_up:slow:${windowOpens.slice(0, 7)}`,
          type: "coming_up",
          comingUpKind: "slow_season",
          personId: null,
          evidence,
          reason: `${FULL_MONTHS[m - 1]} was quiet in ${slowYears.join(" and ")}. Start reconnecting with past clients now to fill it.`,
          confidence: 0.65,
          windowOpens: isoDay(windowOpens),
          reachOutBy: isoDay(addDays(windowOpens, -56) < now ? now : addDays(windowOpens, -56)),
        },
        now,
      ),
    );
  }
  return out;
}

export function detectComingUp(input: ComingUpInput): OpportunitySignal[] {
  return [
    ...detectRepeatClientCycles(input),
    ...detectJobChanges(input),
    ...detectSlowSeasons(input),
  ];
}
