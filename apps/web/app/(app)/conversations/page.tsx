import Link from "next/link";
import { formatDate, loadStudio, lookups } from "@/lib/data";

const STATUS: Record<string, string> = {
  inquiry: "New inquiry",
  intro: "Introduction",
  stalled: "Follow up",
  waiting: "Waiting on you",
};

export default async function Conversations() {
  const data = await loadStudio();
  const find = lookups(data);
  const openByThread = new Map(
    data.signals
      .filter((s) => s.status === "open" && s.type in STATUS)
      .map((s) => [s.id.split(":").at(-1), s]),
  );
  const threads = find.conversations();

  return (
    <>
      <h1 className="font-serif text-4xl tracking-tight">Conversations</h1>
      <p className="mt-2 text-muted">Business threads Flossamer found in your email. Personal mail never appears here.</p>

      {threads.length === 0 ? (
        <p className="mt-8 text-muted">No business conversations yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-rule border-y border-rule">
          {threads.map(({ threadId, thread, last }) => {
            const person = find.person(last.personId);
            const open = openByThread.get(threadId);
            return (
              <li key={threadId} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-6">
                <p className="w-32 shrink-0 text-sm text-muted tabular-nums">{formatDate(last.at)}</p>
                <div className="min-w-0 flex-1">
                  {person ? (
                    <Link href={`/people/${person.id}`} className="font-medium hover:underline">
                      {person.name}
                    </Link>
                  ) : (
                    <p className="font-medium">{last.counterpart}</p>
                  )}
                  <p className="text-pretty text-muted">{last.summary}</p>
                </div>
                <p className="shrink-0 text-sm">
                  {open ? (
                    <span className="rounded bg-accent-soft px-2 py-0.5">{STATUS[open.type]}</span>
                  ) : (
                    <span className="text-muted">
                      {thread.length} {thread.length === 1 ? "message" : "messages"}
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
