import Link from "next/link";
import type { Connection } from "@/lib/data";

/** Tells the user what Flossamer is doing with their mail right now. */
export function SyncBanner({ connection }: { connection: Connection | null }) {
  if (!connection) {
    return <Notice>Gmail isn&apos;t connected. <Link className="underline" href="/login">Connect it</Link> to start.</Notice>;
  }
  if (connection.syncState === "pending" || connection.syncState === "backfilling") {
    return (
      <Notice>
        Reading your mail for business conversations: {connection.processed.toLocaleString("en-US")} messages so far. New findings
        appear here as they&apos;re ready.
      </Notice>
    );
  }
  if (connection.syncState === "error" || connection.syncState === "revoked") {
    return (
      <Notice>
        {connection.syncError ?? "Flossamer can't reach Gmail."}{" "}
        <Link className="underline" href="/login">Reconnect</Link>
      </Notice>
    );
  }
  return null;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="mt-6 rounded-lg bg-accent-soft px-4 py-3 text-sm">
      {children}
    </p>
  );
}
