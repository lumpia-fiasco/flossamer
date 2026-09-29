"use client";

import type { SourceRow } from "@flossamer/db";
import { useState, useTransition } from "react";
import { checkRadarNow, followFeed, followStarter, removeSource, setSourceEnabled, type ActionResult } from "@/lib/actions";

interface Suggestion {
  url: string;
  title: string;
}

/** IR-01, IR-02: the publications Flossamer reads for you. */
export function RadarSources({ sources, suggestions }: { sources: SourceRow[]; suggestions: Suggestion[] }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (action: () => Promise<ActionResult>, done?: string) =>
    start(async () => {
      const result = await action();
      setMessage(result.ok ? (done ?? null) : result.message);
    });

  const following = sources.filter((s) => s.origin !== "newsletter" || s.enabled);
  const fromInbox = sources.filter((s) => s.origin === "newsletter" && !s.enabled);

  return (
    <div className="space-y-8">
      <div>
        <h3 className="font-medium">Following</h3>
        {following.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing yet. Pick a few publications below.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule border-y border-rule">
            {following.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div className="min-w-0">
                  <p className={s.enabled ? "" : "text-muted line-through"}>{s.title}</p>
                  <p className="truncate text-muted">
                    {s.last_error ? `Couldn't read: ${s.last_error}` : s.last_fetched_at ? `Checked ${new Date(s.last_fetched_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Not checked yet"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button disabled={pending} onClick={() => run(() => setSourceEnabled(s.id, !s.enabled))} className="rounded-md border border-rule px-3 py-1 disabled:opacity-60">
                    {s.enabled ? "Pause" : "Resume"}
                  </button>
                  <button disabled={pending} onClick={() => run(() => removeSource(s.id))} className="rounded-md px-3 py-1 text-muted hover:text-ink disabled:opacity-60">
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {suggestions.length > 0 && (
        <div>
          <h3 className="font-medium">Suggested for your work</h3>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {suggestions.map((s) => (
              <li key={s.url}>
                <button disabled={pending} onClick={() => run(() => followStarter(s.url))} className="rounded-full border border-rule px-3 py-1 hover:border-ink disabled:opacity-60">
                  + {s.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fromInbox.length > 0 && (
        <div>
          <h3 className="font-medium">Newsletters you already get</h3>
          <p className="mt-1 text-sm text-muted">Found from the sender details only. Flossamer didn&apos;t open them.</p>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {fromInbox.map((s) => (
              <li key={s.id}>
                <button disabled={pending} onClick={() => run(() => setSourceEnabled(s.id, true))} className="rounded-full border border-rule px-3 py-1 hover:border-ink disabled:opacity-60">
                  + {s.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          e.currentTarget.reset();
          run(() => followFeed(form), "Added. New posts are checked within a few minutes.");
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="text-sm font-medium">Follow another publication</span>
          <input
            name="url"
            placeholder="someone.substack.com or a feed address"
            className="mt-1 w-full rounded-md border border-rule bg-surface px-3 py-2"
          />
        </label>
        <button disabled={pending} className="rounded-md bg-ink px-4 py-2 text-paper disabled:opacity-60">
          Follow
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button disabled={pending} onClick={() => run(checkRadarNow, "Checking now. Anything worth your time shows up on This week.")} className="rounded-md border border-rule px-3 py-1.5 disabled:opacity-60">
          Check now
        </button>
        {message && (
          <p role="status" className="text-muted">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
