# Flossamer

An AI studio manager for independent designers. It reads your business email, rebuilds your relationship history, and tells you who to get back in touch with, and why, before the opportunity goes cold.

Product spec: [Flossamer PRD v2.1](https://claude.ai/code/artifact/050e6244-83ee-4717-8fba-2ba2b94807db)

## Layout

```
apps/web          Next.js 16 app on Vercel: pages, server actions, Auth.js, Inngest functions
packages/core     Domain model, business filter, signal detectors, weekly briefing (no I/O)
packages/agents   Claude-backed steps: mail classification, thread extraction, drafts, voice
packages/mail     Gmail client and a resumable, idempotent backfill
packages/db       Postgres schema, migrations and every query, each scoped to one studio
packages/radar    Industry radar: RSS/Atom reading, starter sources, newsletter detection from headers
```

## How it works

1. **Sign in with Google (Auth.js).** One consent grants Gmail read and draft access. The refresh token is encrypted (AES-256-GCM) into `integration_secrets`, which no export or general query touches. The studio id lives in the signed session token, and every query is scoped to it; `packages/db/src/repo.test.ts` checks that one studio can never read or change another's rows.
2. **Backfill (Inngest).** One step per page of 100 messages. Headers go through the business filter first; personal and automated mail never reaches a model and its body is never fetched. Business mail becomes `interactions` (reference plus a short summary, never the full body).
3. **Extraction.** Threads active in the last 120 days are read in full, in memory, and Claude extracts only what's stated: inquiry or intro, budget, timeline, deferred intent.
4. **Signals.** The deterministic detectors in `packages/core` run over the stored history and are reconciled with what's stored. The user's decisions (snooze, done, not relevant) are never overwritten.
5. **Sync.** Every 10 minutes for live integrations, plus a daily pass so time-based signals move along.
6. **Drafts.** "Open draft" writes a grounded draft in the user's voice and saves it to Gmail Drafts. There is no send path.
7. **Industry radar.** Daily, Flossamer reads new public posts from the publications a user follows. A cheap triage pass picks a few, and those are read against the user's services and the facts it holds about their clients. Only client matches (Coming up) and service matches (Worth writing about) surface, at most 3 a week, each linked to its source. Stored: link, title and one line; never the article.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000; sample data until DATABASE_URL is set
npm test
npm run typecheck
```

## Set up real accounts

**1. Neon**
- Create a project (or add Neon from the Vercel Marketplace, which fills in `DATABASE_URL` for you).
- Run the migrations with the direct (non-pooled) connection string: `DATABASE_URL=<direct url> npm run db:migrate`. Run it again after pulling changes that add a file to `packages/db/migrations`, before deploying.
- Put the pooled connection string in `apps/web/.env.local` as `DATABASE_URL`.

**2. Google Cloud**
- Enable the Gmail API.
- Create an OAuth client (Web application). Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` and `https://<your-domain>/api/auth/callback/google`.
- On the OAuth consent screen, add the scopes `gmail.readonly` and `gmail.compose`, and add each pilot user under Test users (up to 100 while unverified).
- Copy the client id and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

**3. Secrets**
- `AUTH_SECRET`: `npx auth secret`. `TOKEN_ENCRYPTION_KEY`: `openssl rand -base64 32`.

**4. Inngest**
- Locally: `npx inngest-cli@latest dev` alongside `npm run dev`, with `INNGEST_DEV=1`.
- Production: create an Inngest app, add `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` to Vercel, and sync `https://<your-domain>/api/inngest`.

**5. Vercel**
- Import the repo with Root Directory `apps/web`. Add every variable from `.env.example`.

## Where the PRD lives in code

| PRD | Code |
| --- | --- |
| CN-01 Gmail connection, token storage | `apps/web/auth.ts`, `packages/mail/src/gmail.ts` |
| EM-01, EM-04 backfill and sync | `apps/web/lib/inngest/functions.ts`, `apps/web/lib/ingest.ts` |
| EM-02 business filter, runs before any model | `packages/core/src/filter.ts` |
| EM-03 retroactive exclusions | `apps/web/lib/actions.ts` (`saveStudio`, `excludePerson`) |
| CN-05, CN-06 people and matching | `packages/db/src/repo.ts` (`resolvePerson`), People page |
| LD-02 stalled, LD-03 waiting, RL-02 quiet | `packages/core/src/signals.ts` |
| AN-01, AN-03, AN-04 Coming up | `packages/core/src/comingUp.ts` |
| CN-04, LD-01, AN-02 extraction | `packages/agents/src/conversation.ts` |
| VC-01 to VC-03 voice and drafts | `packages/agents/src/drafts.ts`, `openDraft` in `apps/web/lib/actions.ts` |
| TD-01 to TD-05 This week | `packages/core/src/briefing.ts`, `apps/web/app/(app)/page.tsx` |
| WK-01 to WK-04, WK-11 Work | `apps/web/app/(app)/work/page.tsx` |
| IR-01 to IR-07 industry radar | `packages/radar`, `packages/agents/src/radar.ts`, `apps/web/lib/radar.ts` |
| Gate 0 findings report | `packages/core/src/findings.ts`, `apps/web/app/(app)/report/page.tsx` |
| TR-01 to TR-04 activity log, export, delete | `apps/web/app/(app)/studio/`, `apps/web/app/api/export/route.ts` |

## Not in v1

Gmail sidebar, meeting capture, industry seasons and company news, website forms, weekly briefing email, and everything the PRD places in Phase 2 or later.
