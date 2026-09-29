"use client";

import { useTransition } from "react";
import { resolveLinkedInSuggestion } from "@/lib/actions";

/** LI-02: a name match is only a suggestion until the user says it's the same person. */
export function LinkedInSuggestion({ profileUrl }: { profileUrl: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2 text-sm">
      <button
        disabled={pending}
        onClick={() => start(async () => void (await resolveLinkedInSuggestion(profileUrl, true)))}
        className="rounded-md bg-ink px-3 py-1 text-paper disabled:opacity-60"
      >
        Same person
      </button>
      <button
        disabled={pending}
        onClick={() => start(async () => void (await resolveLinkedInSuggestion(profileUrl, false)))}
        className="rounded-md px-3 py-1 text-muted hover:text-ink disabled:opacity-60"
      >
        Not them
      </button>
    </div>
  );
}
