import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user's studio, via their own session (row-level security applies). */
export async function currentStudio() {
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const { data: studio, error } = await db.from("studios").select("id").single();
  if (error || !studio) redirect("/login");

  return { db, studioId: studio.id as string, email: (claims.claims.email as string | undefined) ?? null };
}
