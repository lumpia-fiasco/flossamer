"use client";

import { useState, useTransition } from "react";
import { createProjectFromSignal, markWrong, openDraft, snoozeSignal, type ActionResult } from "@/lib/actions";

export function SignalActions({
  signalId,
  canStartProject,
  canDraft = true,
}: {
  signalId: string;
  canStartProject: boolean;
  canDraft?: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const run = (action: () => Promise<ActionResult>, busy: string) => {
    setMessage(busy);
    start(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.message);
      else if (result.url) {
        window.open(result.url, "_blank", "noopener");
        setMessage("Draft saved in Gmail. Edit and send it from there.");
      } else setMessage(null);
    });
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2 text-sm">
        {canDraft && (
          <button
            disabled={pending}
            onClick={() => run(() => openDraft(signalId), "Writing a draft in your voice...")}
            className="rounded-md bg-ink px-3 py-1.5 text-paper disabled:opacity-60"
          >
            Open draft
          </button>
        )}
        <button disabled={pending} onClick={() => run(() => snoozeSignal(signalId), "Snoozing for a week...")} className="rounded-md border border-rule px-3 py-1.5 disabled:opacity-60">
          Snooze a week
        </button>
        {canStartProject && (
          <button disabled={pending} onClick={() => run(() => createProjectFromSignal(signalId), "Adding to Work...")} className="rounded-md border border-rule px-3 py-1.5 disabled:opacity-60">
            Add to Work
          </button>
        )}
        <button disabled={pending} onClick={() => setAsking((a) => !a)} className="rounded-md px-3 py-1.5 text-muted hover:text-ink disabled:opacity-60">
          Not relevant
        </button>
      </div>

      {asking && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get("reason");
            setAsking(false);
            run(() => markWrong(signalId, reason ? String(reason) : null), "Removing...");
          }}
        >
          <label className="sr-only" htmlFor={`reason-${signalId}`}>
            Why isn&apos;t this relevant? (optional)
          </label>
          <input
            id={`reason-${signalId}`}
            name="reason"
            placeholder="Why not? (optional)"
            className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-3 py-1.5"
          />
          <button className="rounded-md border border-rule px-3 py-1.5">Remove</button>
        </form>
      )}

      {message && (
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
