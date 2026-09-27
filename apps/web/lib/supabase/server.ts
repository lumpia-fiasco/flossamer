import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { required } from "@/lib/env";

/** Supabase client acting as the signed-in user. Row-level security applies. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes sessions.
        }
      },
    },
  });
}
