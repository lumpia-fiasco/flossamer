import type { OpportunitySignal } from "@flossamer/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignalCard } from "@/components/SignalCard";
import { SyncBanner } from "@/components/SyncBanner";
import { formatDate, loadStudio, type StudioData } from "@/lib/data";

function Section({ title, note, signals, data }: { title: string; note: string; signals: OpportunitySignal[]; data: StudioData }) {
  if (signals.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="font-serif text-2xl tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted">{note}</p>
      <div className="mt-5 space-y-4">
        {signals.map((s) => (
          <SignalCard key={s.id} signal={s} data={data} />
        ))}
      </div>
    </section>
  );
}

export default async function ThisWeek() {
  const data = await loadStudio();
  if (!data.studio.onboarded_at) redirect("/onboarding");
  const b = data.briefing;
  const reading = data.connection?.syncState === "pending" || data.connection?.syncState === "backfilling";

  return (
    <>
      <p className="text-sm text-muted">Week of {formatDate(b.weekOf)}</p>
      <h1 className="mt-1 font-serif text-4xl tracking-tight">This week in your studio</h1>
      <p className="mt-2 text-sm">
        <Link href="/report" className="text-muted underline hover:text-ink">
          See everything Flossamer found in your mail
        </Link>
      </p>
      <SyncBanner connection={data.connection} />

      {b.isQuiet ? (
        !reading && (
          <p className="mt-8 max-w-prose leading-relaxed text-muted">
            A quiet week. Nothing needs you right now, and that&apos;s fine.
          </p>
        )
      ) : (
        <>
          <Section data={data} title="New conversations" note="Inquiries and introductions that arrived." signals={b.newConversations} />
          <Section data={data} title="Waiting on you" note="People who wrote and haven't heard back." signals={b.waitingOnYou} />
          <Section data={data} title="Follow up" note="You sent something and haven't had a reply." signals={b.followUps} />
          <Section data={data} title="Coming up" note="Moments to reach out before they arrive." signals={b.comingUp} />
          <Section data={data} title="Reconnect" note="Good relationships that have gone quiet." signals={b.reconnects} />
          <Section data={data} title="Worth writing about" note="Trends in what you read that match what you offer." signals={b.ideas} />
        </>
      )}
    </>
  );
}
