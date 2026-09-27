import {
  SAMPLE_NOW,
  composeBriefing,
  detectAll,
  groupByThread,
  sampleAgentSignals,
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
import * as repo from "@/lib/repo";
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
  studio: Pick<repo.StudioRow, "display_name" | "profile" | "voice" | "exclusions" | "stages" | "backfill_months" | "onboarded_at">;
  connection: Connection | null;
  people: Person[];
  interactions: Interaction[];
  projects: Project[];
  signals: OpportunitySignal[];
  briefing: Briefing;
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
};

/** Everything a page needs about the studio: sample data in demo mode, the database otherwise. */
export async function loadStudio(): Promise<StudioData> {
  if (isDemo) {
    const signals = [...detectAll({ now: SAMPLE_NOW, people: samplePeople, interactions: sampleInteractions, projects: sampleProjects }), ...sampleAgentSignals];
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
    };
  }

  const { db, studioId } = await currentStudio();
  const now = new Date().toISOString();
  const [studio, people, interactions, projects, signals, integration] = await Promise.all([
    repo.getStudio(db, studioId),
    repo.listPeople(db, studioId),
    repo.listInteractions(db, studioId),
    repo.listProjects(db, studioId),
    repo.listSignals(db, studioId),
    db.from("integrations").select("account_email, sync_state, sync_error, checkpoint, last_synced_at").eq("studio_id", studioId).maybeSingle(),
  ]);

  const row = integration.data;
  return {
    demo: false,
    now,
    studio,
    connection: row
      ? {
          accountEmail: row.account_email,
          syncState: row.sync_state,
          syncError: row.sync_error,
          processed: row.checkpoint?.processed ?? 0,
          lastSyncedAt: row.last_synced_at,
        }
      : null,
    people,
    interactions,
    projects,
    signals,
    briefing: composeBriefing(signals, now),
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
