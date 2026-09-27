import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";

/**
 * The signed-in user's studio. The studio id comes from the signed session
 * token, and every repository call is scoped to it.
 */
export async function currentStudio() {
  const session = await auth();
  if (!session?.studioId) redirect("/login");
  return { db: db(), studioId: session.studioId, email: session.user?.email ?? null };
}
