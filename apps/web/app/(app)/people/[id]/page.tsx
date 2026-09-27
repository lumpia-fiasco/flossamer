import Link from "next/link";
import { notFound } from "next/navigation";
import { PersonReview } from "@/components/PersonReview";
import { RELATIONSHIP_LABEL } from "@/lib/labels";
import { SignalCard } from "@/components/SignalCard";
import { formatDate, loadStudio, lookups } from "@/lib/data";

/** CN-08: one timeline per person. */
export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const { id } = await params;
  const data = await loadStudio();
  const find = lookups(data);
  const person = find.person(id);
  if (!person) notFound();

  const history = find.history(person.id);
  const signals = data.signals.filter((s) => s.personId === person.id && s.status === "open");
  const projects = data.projects.filter((p) => p.personIds.includes(person.id));
  const referrer = find.person(person.referredById);

  return (
    <>
      <Link href="/people" className="text-sm text-muted hover:text-ink">
        ← People
      </Link>
      <h1 className="mt-3 font-serif text-4xl tracking-tight">{person.name}</h1>
      <p className="mt-2 text-muted">
        {person.confirmed ? RELATIONSHIP_LABEL[person.relationship.value] : "Not confirmed yet"} · {person.emails.join(", ")}
        {referrer && <> · introduced by {referrer.name}</>}
      </p>
      {!person.confirmed && <PersonReview personId={person.id} suggested={person.relationship.value} />}

      {signals.length > 0 && (
        <section className="mt-10 space-y-4">
          {signals.map((s) => (
            <SignalCard key={s.id} signal={s} data={data} />
          ))}
        </section>
      )}

      {projects.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-2xl tracking-tight">Work together</h2>
          <ul className="mt-4 space-y-1">
            {projects.map((p) => (
              <li key={p.id}>
                {p.title} <span className="text-muted">· {p.stage}{p.paidAmount !== null && ` · paid $${p.paidAmount.toLocaleString("en-US")}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="font-serif text-2xl tracking-tight">Timeline</h2>
        <ol className="mt-4 space-y-3 border-l border-rule pl-4">
          {history.map((i) => (
            <li key={i.id}>
              <p className="text-sm text-muted">
                {formatDate(i.at)} · {i.direction === "outbound" ? "You wrote" : `${person.name.split(" ")[0]} wrote`}
              </p>
              <p className="text-pretty">{i.summary}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
