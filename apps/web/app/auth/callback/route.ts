import { NextResponse, type NextRequest } from "next/server";
import { encrypt } from "@/lib/crypto";
import { GMAIL_SCOPES } from "@/lib/env";
import { EVENTS, inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Google OAuth callback. Google's refresh token is only available here, right
 * after the code exchange, so this is where the Gmail integration is stored.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const fail = (message: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
  if (!code) return fail("Sign-in was cancelled.");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) return fail(error?.message ?? "Sign-in failed.");

  const { user, session } = data;
  const admin = createAdminClient();

  const { data: studio, error: studioError } = await admin
    .from("studios")
    .upsert({ owner_id: user.id, display_name: user.user_metadata.full_name ?? null }, { onConflict: "owner_id" })
    .select("id, onboarded_at")
    .single();
  if (studioError) return fail(studioError.message);

  // Google omits the refresh token when the user skipped a scope or reused an old grant.
  if (!session.provider_refresh_token) {
    return fail("Flossamer needs read and draft access to Gmail. Please allow both permissions.");
  }

  const { data: integration, error: integrationError } = await admin
    .from("integrations")
    .upsert(
      {
        studio_id: studio.id,
        provider: "gmail",
        account_email: user.email,
        scopes: GMAIL_SCOPES,
        revoked_at: null,
        sync_error: null,
      },
      { onConflict: "studio_id,provider,account_email" },
    )
    .select("id, sync_state")
    .single();
  if (integrationError) return fail(integrationError.message);

  const { error: secretError } = await admin
    .from("integration_secrets")
    .upsert({ integration_id: integration.id, refresh_token_encrypted: encrypt(session.provider_refresh_token) });
  if (secretError) return fail(secretError.message);

  if (["pending", "error", "revoked"].includes(integration.sync_state)) {
    await admin.from("integrations").update({ sync_state: "pending" }).eq("id", integration.id);
    await inngest.send({
      name: EVENTS.backfillRequested,
      data: { studioId: studio.id, integrationId: integration.id },
    });
  }

  return NextResponse.redirect(new URL(studio.onboarded_at ? "/" : "/onboarding", request.url));
}
