import {
  SAMPLE_NOW,
  composeBriefing,
  composeFindings,
  gateZeroOutcome,
  type FindingsReport,
  detectAll,
  groupByThread,
  sampleAgentSignals,
  sampleRadarSignals,
  sampleInteractions,
  samplePeople,
  sampleProjects,
  type Briefing,
  type Interaction,
  type OpportunitySignal,
  type Person,
  type Project,
} from "@flossamer/core";
import { isDemo } from "@/lib/env";
import * as repo from "@flossamer/db";
import { currentStudio } from "@/lib/session";

export interface Connection {
  accountEmail: string;
  syncState: "pending" | "backfilling" | "live" | "error" | "revoked";
  syncError: string | null;
  processed: number;
  lastSyncedAt: string | null;
}

export interface StudioData {
  demo: boolean;
  now: string;
  studio: Pick<
    repo.StudioRow,
    | "display_name"
    | "profile"
    | "voice"
    | "exclusions"
    | "stages"
    | "backfill_months"
    | "onboarded_at"
    | "radar_enabled"
    | "radar_newsletters"
    | "linkedin_notifications"
    | "linkedin_imported_at"
  >;
  connection: Connection | null;
  people: Person[];
  interactions: Interaction[];
  projects: Project[];
  signals: OpportunitySignal[];
  briefing: Briefing;
  sources: repo.SourceRow[];
}

const DEMO_STUDIO: StudioData["studio"] = {
  display_name: "Sample designer",
  profile: {
    services: "Product design, UX research sprints, design systems",
    typicalEngagements: "4 to 12 week projects, $12k to $40k",
    idealClients: "Seed to Series B product teams without a design lead",
  },
  voice: { tone: "Warm, direct and brief.", typicalLength: "short", greetings: ["Hi"], signOffs: ["Best"], avoid: ["Just checking in"] },
  exclusions: { senders: [], domains: [], labels: [] },
  stages: ["Conversation", "Proposal out", "Booked", "In progress", "Wrapped"],
  backfill_months: 12,
  onboarded_at: SAMPLE_NOW,
  radar_enabled: true,
  radar_newsletters: false,
  linkedin_notifications: false,
  linkedin_imported_at: null,
};

const sampleSources: repo.SourceRow[] = [
  { id: "src-1", url: "https://www.nngroup.com/feed/rss/", title: "Nielsen Norman Group", origin: "suggested", enabled: true, last_fetched_at: SAMPLE_NOW, last_error: null },
  { id: "src-2", url: "https://www.lennysnewsletter.com/feed", title: "Lenny's Newsletter", origin: "user", enabled: true, last_fetched_at: SAMPLE_NOW, last_error: null },
];

/** Everything a page needs about the studio: sample data in demo mode, the database otherwise. */
export async function loadStudio(): Promise<StudioData> {
  if (isDemo) {
    const signals = [
      ...detectAll({ now: SAMPLE_NOW, people: samplePeople, interactions: sampleInteractions, projects: sampleProjects }),
      ...sampleAgentSignals,
      ...sampleRadarSignals,
    ];
    return {
      demo: true,
      now: SAMPLE_NOW,
      studio: DEMO_STUDIO,
      connection: { accountEmail: "you@yourstudio.com", syncState: "live", syncError: null, processed: sampleInteractions.length, lastSyncedAt: SAMPLE_NOW },
      people: samplePeople,
      interactions: sampleInteractions,
      projects: sampleProjects,
      signals,
      briefing: composeBriefing(signals, SAMPLE_NOW),
      sources: sampleSources,
    };
  }

  const { db, studioId } = await currentStudio();
  const now = new Date().toISOString();
  const [studio, people, interactions, projects, signals, integration, sources] = await Promise.all([
    repo.getStudio(db, studioId),
    repo.listPeople(db, studioId),
    repo.listInteractions(db, studioId),
    repo.listProjects(db, studioId),
    repo.listSignals(db, studioId),
    repo.getIntegration(db, studioId),
    repo.listSources(db, studioId),
  ]);

  return {
    demo: false,
    now,
    studio,
    connection: integration
      ? {
          accountEmail: integration.account_email,
          syncState: integration.sync_state,
          syncError: integration.sync_error,
          processed: integration.checkpoint?.processed ?? 0,
          lastSyncedAt: integration.last_synced_at,
        }
      : null,
    people,
    interactions,
    projects,
    signals,
    briefing: composeBriefing(signals, now),
    sources,
  };
}

/** Lookups over loaded data, for rendering. */
export function lookups(data: StudioData) {
  const people = new Map(data.people.map((p) => [p.id, p]));
  const interactions = new Map(data.interactions.map((i) => [i.id, i]));
  const byPerson = new Map<string, Interaction[]>();
  for (const i of data.interactions) {
    if (!i.personId) continue;
    const list = byPerson.get(i.personId) ?? [];
    list.push(i);
    byPerson.set(i.personId, list);
  }
  return {
    person: (id: string | null) => (id ? people.get(id) : undefined),
    interaction: (id: string) => interactions.get(id),
    history: (personId: string) => (byPerson.get(personId) ?? []).sort((a, b) => b.at.localeCompare(a.at)),
    lastContact: (personId: string) => (byPerson.get(personId) ?? []).reduce<Interaction | undefined>((latest, i) => (!latest || i.at > latest.at ? i : latest), undefined),
    conversations: () =>
      [...groupByThread(data.interactions)]
        .map(([threadId, thread]) => ({ threadId, thread, last: thread.at(-1)! }))
        .filter(({ last }) => last.personId)
        .sort((a, b) => b.last.at.localeCompare(a.last.at)),
  };
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export interface ReportData {
  data: StudioData;
  report: FindingsReport;
  gateZero: ReturnType<typeof gateZeroOutcome>;
}

/** The findings report, and whether this studio has passed Gate 0. Opening it counts as viewing it. */
export async function loadReport(): Promise<ReportData> {
  const data = await loadStudio();
  if (data.demo) {
    const report = composeFindings({ ...data, mail: { business: data.interactions.length, personal: 840, automated: 3100 } });
    return { data, report, gateZero: gateZeroOutcome({ firstViewedAt: null, actionsAt: [], now: data.now }) };
  }
  const { db, studioId } = await currentStudio();
  await repo.recordReportView(db, studioId);
  const [mail, events] = await Promise.all([repo.mailClassCounts(db, studioId), repo.gateZeroEvents(db, studioId)]);
  return {
    data,
    report: composeFindings({ ...data, mail }),
    gateZero: gateZeroOutcome({ ...events, now: data.now }),
  };
}

export interface PersonLinkedIn {
  role: string | null;
  profileUrl: string;
  previous: string | null;
  colleagues: { name: string; position: string | null; profileUrl: string }[];
  events: { kind: "new_position" | "post"; text: string; at: string }[];
}

/** LI-04, LI-05, LI-07: what LinkedIn adds to one person's page. */
export async function loadPersonLinkedIn(personId: string): Promise<PersonLinkedIn | null> {
  if (isDemo) return null;
  const { db, studioId } = await currentStudio();
  const [byPerson, events] = await Promise.all([repo.linkedInByPerson(db, studioId), repo.listLinkedInEvents(db, studioId, personId)]);
  const row = byPerson.get(personId);
  if (!row && events.length === 0) return null;
  const colleagues = row?.company ? await repo.connectionsAt(db, studioId, row.company, row.profile_url) : [];
  return {
    role: row ? [row.position, row.company].filter(Boolean).join(" at ") || null : null,
    profileUrl: row?.profile_url ?? "",
    previous: row?.previous_company ? [row.previous_position, row.previous_company].filter(Boolean).join(" at ") : null,
    colleagues: colleagues.map((c) => ({ name: `${c.first_name} ${c.last_name}`.trim(), position: c.position, profileUrl: c.profile_url })),
    events,
  };
}
