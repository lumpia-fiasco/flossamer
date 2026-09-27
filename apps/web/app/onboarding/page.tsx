import { ExclusionFields, ProfileFields } from "@/components/StudioFields";
import { SyncBanner } from "@/components/SyncBanner";
import { finishOnboarding } from "@/lib/actions";
import { loadStudio } from "@/lib/data";

/**
 * Onboarding (PRD section 8). Gmail is already connected by sign-in and the
 * backfill is running, so this page only sets boundaries and the profile
 * while the first findings come in.
 */
export default async function Onboarding() {
  const data = await loadStudio();

  return (
    <div className="mx-auto max-w-xl px-4 py-12 md:py-16">
      <p className="font-serif text-2xl">flossamer</p>
      <h1 className="mt-8 font-serif text-4xl tracking-tight">Welcome to your studio.</h1>
      <p className="mt-3 text-pretty text-muted">
        Flossamer is reading your mail for business conversations. While it works, tell it what to leave alone and what you do.
      </p>
      <SyncBanner connection={data.connection} />

      <form action={finishOnboarding} className="mt-10 space-y-12">
        <section>
          <h2 className="font-serif text-2xl tracking-tight">1. What to leave alone</h2>
          <p className="mt-1 mb-5 text-sm text-muted">
            Personal mail is set aside before any AI reads it. Anything listed here is never read at all.
          </p>
          <ExclusionFields studio={data.studio} />
        </section>

        <section>
          <h2 className="font-serif text-2xl tracking-tight">2. Your studio</h2>
          <p className="mt-1 mb-5 text-sm text-muted">Drafts only mention what you describe here or what&apos;s in your email.</p>
          <ProfileFields studio={data.studio} />
        </section>

        <button className="rounded-md bg-ink px-5 py-2.5 text-paper">See this week</button>
      </form>
    </div>
  );
}
