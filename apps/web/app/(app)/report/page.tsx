import type { Finding, FindingsReport } from "@flossamer/core";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { SignalActions } from "@/components/SignalActions";
import { SyncBanner } from "@/components/SyncBanner";
import { formatDate, loadReport, type ReportData } from "@/lib/data";

const n = (v: number) => v.toLocaleString("en-US");

function Totals({ totals }: { totals: FindingsReport["totals"] }) {
  const stats = [
    { value: totals.businessMessages, label: "business emails read" },
    { value: totals.conversations, label: "conversations" },
    { value: totals.people, label: "people" },
    { value: totals.clients, label: "clients and past clients" },
  ];
  return (
    <>
      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface p-4">
            <dd className="font-serif text-3xl tabular-nums">{n(s.value)}</dd>
            <dt className="mt-1 text-sm text-muted">{s.label}</dt>
          </div>
        ))}
      </dl>
      {(totals.setAsidePersonal > 0 || totals.setAsideAutomated > 0) && (
        <p className="mt-3 text-sm text-muted">
          {n(totals.setAsidePersonal)} personal and {n(totals.setAsideAutomated)} automated emails were set aside without being read.
        </p>
      )}
    </>
  );
}

function Item({ item, canAct }: { item: Finding; canAct: boolean }) {
  return (
    <li className="break-inside-avoid py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="font-medium">
          {item.personId ? (
            <Link href={`/people/${item.personId}`} className="hover:underline">
              {item.personName}
            </Link>
          ) : (
            "Your studio"
          )}
        </p>
        <p className="text-sm text-muted">
          {item.reachOutBy
            ? `Reach out by ${formatDate(item.reachOutBy)}`
            : item.lastContact && `Last in touch ${formatDate(item.lastContact)}`}
        </p>
      </div>
      <p className="mt-1 text-pretty leading-relaxed">{item.reason}</p>
      {canAct && item.personId && (
        <div className="print:hidden">
          <SignalActions signalId={item.signalId} canStartProject={false} />
        </div>
      )}
    </li>
  );
}

function GateZero({ gate }: { gate: ReportData["gateZero"] }) {
  const text = {
    not_viewed: "Opened for the first time just now.",
    acted: `Acted on a finding ${gate.actedAt ? formatDate(gate.actedAt) : ""}, within a week of first opening the report.`,
    waiting: `${gate.daysLeft} ${gate.daysLeft === 1 ? "day" : "days"} left to act on a finding.`,
    no_action: "No finding was acted on within a week of first opening the report.",
  }[gate.status];
  return (
    <aside className="mt-12 rounded-lg border border-dashed border-rule p-4 text-sm print:hidden">
      <p className="font-medium">Gate 0 (pilot only)</p>
      <p className="mt-1 text-muted">
        {text} Acting means opening a draft or adding a finding to Work within 7 days.
      </p>
    </aside>
  );
}

/** Gate 0 findings report: what the backfill found, on one printable page. */
export default async function Report() {
  const { data, report, gateZero } = await loadReport();
  const reading = data.connection?.syncState === "pending" || data.connection?.syncState === "backfilling";
  const top = report.topPick;

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {report.periodStart ? `${formatDate(report.periodStart)} to ${formatDate(report.generatedAt)}` : formatDate(report.generatedAt)}
            {data.studio.display_name && ` · ${data.studio.display_name}`}
          </p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight">What Flossamer found</h1>
        </div>
        <PrintButton />
      </div>
      {reading && <SyncBanner connection={data.connection} />}

      <Totals totals={report.totals} />

      {top && (
        <section className="mt-10 rounded-lg border-2 border-accent bg-accent-soft p-5 break-inside-avoid">
          <p className="text-sm font-medium text-accent">Start here</p>
          <ul>
            <Item item={top} canAct />
          </ul>
        </section>
      )}

      {report.sections.length === 0 ? (
        <p className="mt-10 text-muted">{reading ? "Findings appear here as your mail is read." : "Nothing needs attention right now."}</p>
      ) : (
        report.sections.map((section) => (
          <section key={section.key} className="mt-10 break-inside-avoid-page">
            <h2 className="font-serif text-2xl tracking-tight">{section.title}</h2>
            <p className="mt-1 text-sm text-muted">{section.note}</p>
            <ul className="mt-2 divide-y divide-rule border-y border-rule">
              {section.items.map((item) => (
                <Item key={item.signalId} item={item} canAct />
              ))}
            </ul>
            {section.more > 0 && (
              <p className="mt-2 text-sm text-muted">
                And {section.more} more on <Link href="/" className="underline print:no-underline">This week</Link>.
              </p>
            )}
          </section>
        ))
      )}

      {!data.demo && <GateZero gate={gateZero} />}
    </article>
  );
}
