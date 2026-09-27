import * as repo from "@flossamer/db";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { GMAIL_SCOPES } from "@/lib/env";
import { EVENTS, inngest } from "@/lib/inngest/client";

declare module "next-auth" {
  interface Session {
    studioId: string;
  }
}

/**
 * Google sign-in doubles as the Gmail connection (CN-01): one consent grants
 * read and draft access, and the refresh token is stored encrypted at sign-in.
 * Env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Google({
      authorization: {
        params: {
          scope: ["openid", "email", "profile", ...GMAIL_SCOPES].join(" "),
          // Offline access + consent so Google returns a refresh token for background sync.
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    signIn({ account }) {
      // Google lets people untick scopes on the consent screen; Flossamer can't work without both.
      const granted = new Set(account?.scope?.split(" ") ?? []);
      if (!GMAIL_SCOPES.every((s) => granted.has(s)) || !account?.refresh_token) {
        return "/login?error=scopes";
      }
      return true;
    },

    async jwt({ token, account, profile }) {
      if (!account || account.provider !== "google") return token; // not a fresh sign-in

      const email = profile?.email ?? token.email;
      if (!email || !account.refresh_token) throw new Error("Google did not return an email and refresh token");

      const conn = db();
      const studio = await repo.upsertStudioForGoogle(conn, { sub: account.providerAccountId, email, name: profile?.name ?? null });
      const integration = await repo.upsertGmailIntegration(conn, studio.id, email, GMAIL_SCOPES);
      await repo.saveSecret(conn, studio.id, integration.id, encrypt(account.refresh_token));

      if (["pending", "error", "revoked"].includes(integration.sync_state)) {
        await repo.markIntegration(conn, studio.id, integration.id, { sync_state: "pending", sync_error: null });
        await inngest.send({ name: EVENTS.backfillRequested, data: { studioId: studio.id, integrationId: integration.id } });
      }

      token.studioId = studio.id;
      return token;
    },

    session({ session, token }) {
      if (typeof token.studioId === "string") session.studioId = token.studioId;
      return session;
    },
  },
});
