import type { StudioData } from "@/lib/data";

const field = "mt-1 w-full rounded-md border border-rule bg-surface px-3 py-2";

/** Profile fields (MK-01), shared by onboarding and Studio settings. */
export function ProfileFields({ studio }: { studio: StudioData["studio"] }) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="font-medium">Your name</span>
        <input name="display_name" defaultValue={studio.display_name ?? ""} className={field} />
      </label>
      <label className="block">
        <span className="font-medium">What you offer</span>
        <span className="block text-sm text-muted">Services, in your words. Drafts only mention what&apos;s here.</span>
        <textarea name="services" rows={2} defaultValue={studio.profile.services ?? ""} className={field} />
      </label>
      <label className="block">
        <span className="font-medium">Typical engagements</span>
        <span className="block text-sm text-muted">Length, size, how you usually work.</span>
        <textarea name="typicalEngagements" rows={2} defaultValue={studio.profile.typicalEngagements ?? ""} className={field} />
      </label>
      <label className="block">
        <span className="font-medium">Ideal clients</span>
        <textarea name="idealClients" rows={2} defaultValue={studio.profile.idealClients ?? ""} className={field} />
      </label>
    </div>
  );
}

/** EM-03: senders and domains Flossamer ignores, applied to past mail on the next sync. */
export function ExclusionFields({ studio }: { studio: StudioData["studio"] }) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="font-medium">Ignore these addresses</span>
        <span className="block text-sm text-muted">One per line: family, friends, your doctor.</span>
        <textarea name="excluded_senders" rows={3} defaultValue={studio.exclusions.senders.join("\n")} className={field} />
      </label>
      <label className="block">
        <span className="font-medium">Ignore these domains</span>
        <span className="block text-sm text-muted">One per line: your bank, your kids&apos; school.</span>
        <textarea name="excluded_domains" rows={3} defaultValue={studio.exclusions.domains.join("\n")} className={field} />
      </label>
    </div>
  );
}
