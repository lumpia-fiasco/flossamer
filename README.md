# Flossamer

An AI studio manager for independent designers. It reads your business email, rebuilds your relationship history, and tells you who to get back in touch with, and why, before the opportunity goes cold.

Product spec: [Flossamer PRD v2.1](https://claude.ai/code/artifact/050e6244-83ee-4717-8fba-2ba2b94807db)

## Layout

```
apps/web          Next.js 16 app on Vercel: pages, server actions, auth, Inngest functions
packages/core     Domain model, business filter, signal detectors, weekly briefing (no I/O)
packages/agents   Claude-backed steps: mail classification, thread extraction, drafts, voice
packages/mail     Gmail client and a resumable, idempotent backfill
supabase/         Postgres schema with row-level security
```

## How it works

1. **Sign in with Google.** One consent grants Gmail read and draft access. The refresh token is encrypted (AES-256-GCM) into `integration_secrets`, a table only the server can read.
2. **Backfill (Inngest).** One step per page of 100 messages. Headers go through the business filter first; personal and automated mail never reaches a model and its body is never fetched. Business mail becomes `interactions` (reference plus a short summary, never the full body).
3. **Extraction.** Threads active in the last 120 days are read in full, in memory, and Claude extracts only what's stated: inquiry or intro, budget, timeline, deferred intent.
4. **Signals.** The deterministic detectors in `packages/core` run over the stored history and are reconciled with what's stored. The user's decisions (snooze, done, not relevant) are never overwritten.
5. **Sync.** Every 10 minutes for live integrations, plus a daily pass so time-based signals move along.
6. **Drafts.** "Open draft" writes a grounded draft in the user's voice and saves it to Gmail Drafts. There is no send path.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000; sample data until Supabase is configured
npm test
npm run typecheck
```

## Set up real accounts

**1. Supabase**
- Create a project, then run `supabase/migrations/20260927000000_init.sql` (SQL editor, or `supabase db push`).
- Copy the URL, anon key and service role key into `apps/web/.env.local` (see `.env.example`).

**2. Google Cloud**
- Create an OAuth client (Web application). Authorized redirect URI: `https://<your-project>.supabase.co/auth/v1/callback`.
- On the OAuth consent screen, add the scopes `gmail.readonly` and `gmail.compose`, and add each pilot user under Test users (up to 100 while unverified).
- Enable the Gmail API for the project.

**3. Supabase Auth**
- Auth > Providers > Google: paste the client id and secret.
- Auth > URL Configuration: add `http://localhost:3000/auth/callback` and your production `/auth/callback` to the redirect allow list.

**4. Inngest**
- Locally: `npx inngest-cli@latest dev` alongside `npm run dev`, with `INNGEST_DEV=1`.
- Production: create an Inngest app, add `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` to Vercel, and sync `https://<your-domain>/api/inngest`.

**5. Vercel**
- Import the repo with Root Directory `apps/web`. Add every variable from `.env.example`.

## Where the PRD lives in code

| PRD | Code |
| --- | --- |
| CN-01 Gmail connection, token storage | `apps/web/app/auth/callback/route.ts`, `packages/mail/src/gmail.ts` |
| EM-01, EM-04 backfill and sync | `apps/web/lib/inngest/functions.ts`, `apps/web/lib/ingest.ts` |
| EM-02 business filter, runs before any model | `packages/core/src/filter.ts` |
| EM-03 retroactive exclusions | `apps/web/lib/actions.ts` (`saveStudio`, `excludePerson`) |
| CN-05, CN-06 people and matching | `apps/web/lib/repo.ts` (`resolvePerson`), People page |
| LD-02 stalled, LD-03 waiting, RL-02 quiet | `packages/core/src/signals.ts` |
| AN-01, AN-03, AN-04 Coming up | `packages/core/src/comingUp.ts` |
| CN-04, LD-01, AN-02 extraction | `packages/agents/src/conversation.ts` |
| VC-01 to VC-03 voice and drafts | `packages/agents/src/drafts.ts`, `openDraft` in `apps/web/lib/actions.ts` |
| TD-01 to TD-05 This week | `packages/core/src/briefing.ts`, `apps/web/app/(app)/page.tsx` |
| WK-01 to WK-04, WK-11 Work | `apps/web/app/(app)/work/page.tsx` |
| TR-01 to TR-04 activity log, export, delete | `apps/web/app/(app)/studio/`, `apps/web/app/api/export/route.ts` |

## Not in v1

Gmail sidebar, meeting capture, industry seasons and company news, website forms, weekly briefing email, and everything the PRD places in Phase 2 or later.
