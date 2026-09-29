"use client";

import { strFromU8, unzipSync } from "fflate";
import { useState, useTransition } from "react";
import { importLinkedIn, type LinkedInImportSummary } from "@/lib/actions";

/**
 * LI-01: pick the export zip (or Connections.csv). The zip is opened here in
 * the browser; only the connections file is sent. Messages never leave this computer.
 */
async function connectionsCsv(file: File): Promise<string> {
  if (/\.csv$/i.test(file.name)) return file.text();
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => /(^|\/)connections\.csv$/i.test(f.name),
  });
  const csv = Object.values(entries)[0];
  if (!csv) throw new Error("No Connections.csv in that zip. Make sure the export includes Connections.");
  return strFromU8(csv);
}

export function LinkedInImport() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<LinkedInImportSummary | null>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    start(async () => {
      try {
        setResult(await importLinkedIn(await connectionsCsv(file)));
      } catch (e) {
        setResult({ ok: false, message: (e as Error).message });
      }
    });
  };

  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-3 rounded-md bg-ink px-4 py-2 text-paper has-disabled:opacity-60">
        {pending ? "Importing..." : "Choose the export (.zip or Connections.csv)"}
        <input
          type="file"
          accept=".zip,.csv"
          disabled={pending}
          className="sr-only"
          onChange={(e) => onFile(e.currentTarget.files?.[0])}
        />
      </label>

      {result && (
        <div role="status" className="mt-4 rounded-lg border border-rule bg-surface p-4 text-sm">
          {result.ok ? (
            <ul className="space-y-1">
              <li>
                {result.total.toLocaleString("en-US")} connections imported ({result.added.toLocaleString("en-US")} new).
              </li>
              <li>{result.matchedByEmail} matched to people Flossamer knows, by email.</li>
              {result.suggestedByName > 0 && <li>{result.suggestedByName} possible matches by name, for you to check below.</li>}
              {result.jobChanges > 0 && <li className="font-medium">{result.jobChanges} job changes since your last import, now on This week.</li>}
              {result.skipped > 0 && <li className="text-muted">{result.skipped} rows skipped (no profile link).</li>}
            </ul>
          ) : (
            <p className="text-accent">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
