import { createClient } from "@supabase/supabase-js";
import { required } from "@/lib/env";

/**
 * Service-role client for background jobs and token storage. Bypasses row-level
 * security, so every query here must be scoped to a studio id explicitly.
 * Never import this from client components.
 */
export function createAdminClient() {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
