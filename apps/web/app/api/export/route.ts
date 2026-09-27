import { exportStudio } from "@flossamer/db";
import { NextResponse } from "next/server";
import { isDemo } from "@/lib/env";
import { currentStudio } from "@/lib/session";

/** TR-02: everything Flossamer stores for this studio, as one JSON file. OAuth secrets are never included. */
export async function GET() {
  if (isDemo) return NextResponse.json({ error: "Export is available once Gmail is connected." }, { status: 400 });
  const { db, studioId } = await currentStudio();
  return new NextResponse(JSON.stringify(await exportStudio(db, studioId), null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="flossamer-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
