import { NextResponse } from "next/server";
import { isDemo } from "@/lib/env";
import { currentStudio } from "@/lib/session";

const TABLES = ["studios", "integrations", "organizations", "people", "person_emails", "interactions", "projects", "signals", "agent_actions"];

/** TR-02: everything Flossamer stores for this studio, as one JSON file. */
export async function GET() {
  if (isDemo) return NextResponse.json({ error: "Export is available once Gmail is connected." }, { status: 400 });
  const { db, studioId } = await currentStudio();

  const out: Record<string, unknown> = { exportedAt: new Date().toISOString() };
  for (const table of TABLES) {
    const { data, error } = await db.from(table).select("*").eq(table === "studios" ? "id" : "studio_id", studioId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    out[table] = data;
  }

  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="flossamer-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
