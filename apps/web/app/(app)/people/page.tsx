import Link from "next/link";
import { PersonReview } from "@/components/PersonReview";
import { RELATIONSHIP_LABEL } from "@/lib/labels";
import { formatDate, loadStudio, lookups } from "@/lib/data";

export default async function People() {
  const data = await loadStudio();
  const find = lookups(data);
  const quiet = new Set(data.signals.filter((s) => s.type === "reconnect" && s.status === "open").map((s) => s.personId));
  const byRecent = (a: { id: string }, b: { id: string }) =>
    (find.lastContact(b.id)?.at ?? "").localeCompare(find.lastContact(a.id)?.at ?? "");

  const toReview = data.people
    .filter((p) => !p.confirmed)
    .sort((a, b) => find.history(b.id).length - find.history(a.id).length)
    .slice(0, 20);
  const confirmed = data.people.filter((p) => p.confirmed).sort(byRecent);

  return (
    <>
      <h1 className="font-serif text-4xl tracking-tight">People</h1>
      <p className="mt-2 text-muted">Everyone you&apos;ve worked with or talked to about work.</p>

      {toReview.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-2xl tracking-tight">To confirm</h2>
          <p className="mt-1 text-sm text-muted">
            Flossamer found these people in business threads. Confirm how you know them, or mark them as not business.
          </p>
          <ul className="mt-5 space-y-3">
            {toReview.map((p) => (
              <li key={p.id} className="rounded-lg border border-rule bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/people/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <p className="text-sm text-muted">
                    {find.history(p.id).length} emails · {p.emails[0]}
                  </p>
                </div>
                <PersonReview personId={p.id} suggested={p.relationship.value} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        {toReview.length > 0 && <h2 className="font-serif text-2xl tracking-tight">Your people</h2>}
        {confirmed.length === 0 ? (
          <p className="mt-4 text-muted">No one confirmed yet.</p>
        ) : (
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {confirmed.map((p) => {
              const last = find.lastContact(p.id);
              const referrer = find.person(p.referredById);
              return (
                <li key={p.id} className="rounded-lg border border-rule bg-surface p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/people/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-sm text-muted">{RELATIONSHIP_LABEL[p.relationship.value]}</p>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">{p.emails.at(-1)}</p>
                  {last && (
                    <p className="mt-3 text-sm">
                      Last in touch {formatDate(last.at)}
                      {quiet.has(p.id) && <span className="text-accent"> · gone quiet</span>}
                    </p>
                  )}
                  {referrer && <p className="mt-1 text-sm text-muted">Introduced by {referrer.name}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
