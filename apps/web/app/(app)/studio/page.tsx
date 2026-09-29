import { suggestSources } from "@flossamer/radar";
import Link from "next/link";
import { RadarSources } from "@/components/RadarSources";
import { ExclusionFields, ProfileFields } from "@/components/StudioFields";
import { deleteEverything, saveRadarOptions, saveStudio, signOut } from "@/lib/actions";
import { formatDate, loadStudio } from "@/lib/data";

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule py-8">
      <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
      {note && <p className="mt-1 max-w-prose text-pretty text-muted">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default async function Studio() {
  const data = await loadStudio();
  const { studio, connection } = data;
  const profileText = Object.values(studio.profile).join(" ");
  const followed = new Set(data.sources.map((s) => s.url));
  const suggestions = suggestSources(profileText).filter((s) => !followed.has(s.url));

  return (
    <>
      <h1 className="font-serif text-4xl tracking-tight">Studio</h1>
      <p className="mt-2 mb-8 text-muted">Your profile, your voice, and what Flossamer can and can&apos;t see.</p>

      <form action={saveStudio}>
        <Section title="Your studio" note="Drafts only mention services and work described here or in your email.">
          <ProfileFields studio={studio} />
        </Section>
        <Section title="Privacy boundaries" note="Mail from these senders and domains is never read. Changes apply from the next sync.">
          <ExclusionFields studio={studio} />
        </Section>
        <button className="rounded-md bg-ink px-4 py-2 text-paper">Save changes</button>
      </form>

      <div className="mt-10" />
      <Section
        title="Industry radar"
        note="Flossamer reads the publications you follow and shows a trend only when it touches one of your clients or something you offer. A few a week at most, each linked to its source."
      >
        <form action={saveRadarOptions} className="mb-8 space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="radar_enabled" defaultChecked={studio.radar_enabled} />
            Read my publications for trends that matter to my clients
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="radar_newsletters" defaultChecked={studio.radar_newsletters} />
            Suggest newsletters I already receive (from the sender details only; they&apos;re never opened)
          </label>
          <button className="mt-2 rounded-md border border-rule px-3 py-1.5">Save</button>
        </form>
        <RadarSources sources={data.sources} suggestions={suggestions} />
      </Section>

      <Section title="Your voice" note="Learned from business mail you've sent. Drafts follow it.">
        {studio.voice ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted">Tone</dt>
            <dd>{studio.voice.tone}</dd>
            <dt className="text-muted">Length</dt>
            <dd className="capitalize">{studio.voice.typicalLength}</dd>
            <dt className="text-muted">Greetings</dt>
            <dd>{studio.voice.greetings.join(", ")}</dd>
            <dt className="text-muted">Sign-offs</dt>
            <dd>{studio.voice.signOffs.join(", ")}</dd>
          </dl>
        ) : (
          <p className="text-muted">Not learned yet. It needs at least five business emails you&apos;ve sent.</p>
        )}
      </Section>

      <Section title="Connected accounts">
        {connection ? (
          <p>
            Gmail: {connection.accountEmail} ·{" "}
            <span className="text-muted">
              {connection.syncState === "live"
                ? `up to date${connection.lastSyncedAt ? ` as of ${formatDate(connection.lastSyncedAt)}` : ""}`
                : connection.syncState === "backfilling" || connection.syncState === "pending"
                  ? "reading your mail"
                  : (connection.syncError ?? "needs reconnecting")}
            </span>
          </p>
        ) : (
          <p className="text-muted">No account connected.</p>
        )}
        <p className="mt-2 max-w-prose text-sm text-muted">
          Read access to find business conversations, and draft access to save replies. Flossamer never sends.
        </p>
      </Section>

      <Section title="Activity log" note="Every suggestion Flossamer made, and what you decided.">
        <Link href="/studio/activity" className="underline">
          Open the activity log
        </Link>
      </Section>

      <Section title="Your data">
        <div className="flex flex-wrap gap-3">
          <a href="/api/export" className="rounded-md border border-rule px-4 py-2">
            Export everything (JSON)
          </a>
          <form action={signOut}>
            <button className="rounded-md border border-rule px-4 py-2">Sign out</button>
          </form>
        </div>
        <form action={deleteEverything} className="mt-6">
          <p className="max-w-prose text-sm text-muted">
            Deleting disconnects Gmail, revokes Flossamer&apos;s access with Google, and removes all your data. It can&apos;t be undone.
          </p>
          <button className="mt-3 rounded-md border border-accent px-4 py-2 text-accent">Delete my account and data</button>
        </form>
      </Section>
    </>
  );
}
