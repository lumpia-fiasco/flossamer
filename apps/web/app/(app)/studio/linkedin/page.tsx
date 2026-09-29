import { suggestedLinkedInMatches } from "@flossamer/db";
import Link from "next/link";
import { LinkedInImport } from "@/components/LinkedInImport";
import { LinkedInSuggestion } from "@/components/LinkedInSuggestion";
import { saveLinkedInOptions } from "@/lib/actions";
import { formatDate, loadStudio } from "@/lib/data";
import { currentStudio } from "@/lib/session";

/** PRD 6.12: LinkedIn from data you own. Flossamer never logs into or scrapes LinkedIn. */
export default async function LinkedInPage() {
  const data = await loadStudio();
  let suggestions: Awaited<ReturnType<typeof suggestedLinkedInMatches>> = [];
  if (!data.demo) {
    const { db, studioId } = await currentStudio();
    suggestions = await suggestedLinkedInMatches(db, studioId);
  }

  return (
    <>
      <Link href="/studio" className="text-sm text-muted hover:text-ink">
        ← Studio
      </Link>
      <h1 className="mt-3 font-serif text-4xl tracking-tight">LinkedIn</h1>
      <p className="mt-2 max-w-prose text-pretty text-muted">
        Flossamer uses LinkedIn data you already own. It never logs into LinkedIn or reads your feed, which LinkedIn&apos;s terms forbid and which could get
        your account restricted.
      </p>

      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="font-serif text-2xl tracking-tight">Import your connections</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Adds roles and companies to the people you work with, and shows who you know at each client. Import again every month or two and Flossamer
          will spot job changes.
          {data.studio.linkedin_imported_at && ` Last imported ${formatDate(data.studio.linkedin_imported_at)}.`}
        </p>
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">
          <li>
            On LinkedIn, open <b>Settings &amp; Privacy</b>, then <b>Data privacy</b>, then <b>Get a copy of your data</b>.
          </li>
          <li>
            Choose <b>Connections</b> (the smaller, faster option) and request the archive. LinkedIn emails you when it&apos;s ready, usually within minutes.
          </li>
          <li>Download the zip and choose it below. Only the connections file is sent to Flossamer; messages stay on your computer.</li>
        </ol>
        <div className="mt-5">
          <LinkedInImport />
        </div>
      </section>

      {suggestions.length > 0 && (
        <section className="mt-10 border-t border-rule pt-8">
          <h2 className="font-serif text-2xl tracking-tight">Is this the same person?</h2>
          <p className="mt-1 text-sm text-muted">These LinkedIn connections share a name with someone in Flossamer. Nothing is linked until you say so.</p>
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {suggestions.map((s) => (
              <li key={s.profile_url} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{s.person_name}</p>
                  <p className="text-muted">
                    On LinkedIn: {[s.position, s.company].filter(Boolean).join(" at ") || "no role listed"} ·{" "}
                    <a href={s.profile_url} target="_blank" rel="noopener noreferrer" className="underline">
                      profile
                    </a>
                  </p>
                </div>
                <LinkedInSuggestion profileUrl={s.profile_url} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="font-serif text-2xl tracking-tight">LinkedIn notification emails</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          LinkedIn already emails you when people start new jobs or post. With this on, Flossamer reads only the subject lines of those emails, never the
          body, and only for people you&apos;ve confirmed. It applies to new mail from the next sync.
        </p>
        <form action={saveLinkedInOptions} className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="linkedin_notifications" defaultChecked={data.studio.linkedin_notifications} />
            Use LinkedIn notification emails for job changes and posts
          </label>
          <button className="rounded-md border border-rule px-3 py-1.5">Save</button>
        </form>
      </section>
    </>
  );
}
