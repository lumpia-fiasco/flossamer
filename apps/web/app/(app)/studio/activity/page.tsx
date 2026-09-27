import Link from "next/link";
import { isDemo } from "@/lib/env";
import { currentStudio } from "@/lib/session";

const DESCRIBE: Record<string, string> = {
  snooze: "Snoozed an item",
  done: "Marked an item done",
  marked_wrong: "Marked an item not relevant",
  confirm_person: "Confirmed a person",
  exclude_person: "Excluded a sender",
};

/** TR-01: every agent suggestion and user decision, newest first. */
export default async function Activity() {
  let rows: { id: string; agent: string; trigger: string; proposed: Record<string, unknown>; approval: string; at: string }[] = [];
  if (!isDemo) {
    const { db, studioId } = await currentStudio();
    const { data } = await db
      .from("agent_actions")
      .select("id, agent, trigger, proposed, approval, at")
      .eq("studio_id", studioId)
      .order("at", { ascending: false })
      .limit(200);
    rows = data ?? [];
  }

  return (
    <>
      <Link href="/studio" className="text-sm text-muted hover:text-ink">
        ← Studio
      </Link>
      <h1 className="mt-3 font-serif text-4xl tracking-tight">Activity log</h1>
      <p className="mt-2 text-muted">What Flossamer suggested and wrote, and what you decided. Newest first.</p>

      {rows.length === 0 ? (
        <p className="mt-8 text-muted">Nothing yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-rule border-y border-rule">
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <p>
                {r.trigger.startsWith("draft:")
                  ? `Drafted: ${String(r.proposed.subject ?? "an email")}`
                  : (DESCRIBE[r.trigger] ?? r.trigger)}
              </p>
              <p className="text-sm text-muted">
                {new Date(r.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                {r.agent === "user" ? "You" : "Flossamer"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
