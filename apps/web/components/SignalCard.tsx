import type { OpportunitySignal } from "@flossamer/core";
import { SignalActions } from "@/components/SignalActions";
import { formatDate, lookups, type StudioData } from "@/lib/data";

const KIND_LABEL: Record<NonNullable<OpportunitySignal["comingUpKind"]>, string> = {
  repeat_client_cycle: "Repeat client",
  deferred_intent: "Said to revisit",
  job_change: "New role",
  slow_season: "Your slow season",
  industry_season: "Industry season",
  company_news: "Company news",
};

/**
 * One card per item: who, why, the source email, and the next step (TD-04).
 * Confidence and "suggested" are always in text, never color alone.
 */
export function SignalCard({ signal, data }: { signal: OpportunitySignal; data: StudioData }) {
  const find = lookups(data);
  const person = find.person(signal.personId);
  const evidence = signal.evidence.map(find.interaction).filter((i) => i !== undefined);
  const isSuggestion = signal.type === "coming_up" || signal.type === "reconnect";
  const heading = person?.name ?? (signal.comingUpKind ? KIND_LABEL[signal.comingUpKind] : "Your studio");

  return (
    <article className="rounded-lg border border-rule bg-surface p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-medium">{heading}</h3>
        {isSuggestion && (
          <p className="text-xs text-suggested">
            Suggested{signal.comingUpKind && person ? ` · ${KIND_LABEL[signal.comingUpKind]}` : ""} ·{" "}
            {Math.round(signal.confidence * 100)}% sure
          </p>
        )}
      </header>

      <p className="mt-2 text-pretty leading-relaxed">{signal.reason}</p>

      {signal.reachOutBy && (
        <p className="mt-3 text-sm">
          <span className="text-muted">Reach out by </span>
          <span className="font-medium">{formatDate(signal.reachOutBy)}</span>
          {signal.windowOpens && signal.windowOpens !== signal.reachOutBy && (
            <span className="text-muted"> · window opens {formatDate(signal.windowOpens)}</span>
          )}
        </p>
      )}

      {evidence.length > 0 && (
        <details className="mt-3 text-sm text-muted">
          <summary className="cursor-pointer select-none">
            Based on {evidence.length} {evidence.length === 1 ? "email" : "emails"}
          </summary>
          <ul className="mt-2 space-y-1 border-l border-rule pl-3">
            {evidence.map((i) => (
              <li key={i.id}>
                {formatDate(i.at)}: {i.summary}
              </li>
            ))}
          </ul>
        </details>
      )}

      {person ? (
        <SignalActions signalId={signal.id} canStartProject={signal.type === "inquiry" || signal.type === "intro"} />
      ) : (
        <p className="mt-4 text-sm text-muted">Pick a few past clients from People and open a reconnect draft for each.</p>
      )}
    </article>
  );
}
