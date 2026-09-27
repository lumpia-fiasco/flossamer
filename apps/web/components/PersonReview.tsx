"use client";

import { useState, useTransition } from "react";
import { confirmPerson, excludePerson } from "@/lib/actions";
import { RELATIONSHIP_LABEL } from "@/lib/labels";


/** CN-06: confirm a proposed person, set how you know them, or mark them not business. */
export function PersonReview({ personId, suggested }: { personId: string; suggested: keyof typeof RELATIONSHIP_LABEL }) {
  const [value, setValue] = useState<string>(suggested);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const result = await action();
      setError(result.ok ? null : (result.message ?? "Something went wrong."));
    });

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <label className="sr-only" htmlFor={`rel-${personId}`}>
        Relationship
      </label>
      <select
        id={`rel-${personId}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-md border border-rule bg-paper px-2 py-1.5"
      >
        {Object.entries(RELATIONSHIP_LABEL).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      <button disabled={pending} onClick={() => run(() => confirmPerson(personId, value))} className="rounded-md bg-ink px-3 py-1.5 text-paper disabled:opacity-60">
        Confirm
      </button>
      <button disabled={pending} onClick={() => run(() => excludePerson(personId))} className="rounded-md px-3 py-1.5 text-muted hover:text-ink disabled:opacity-60">
        Not business
      </button>
      {error && <p role="alert" className="w-full text-accent">{error}</p>}
    </div>
  );
}
