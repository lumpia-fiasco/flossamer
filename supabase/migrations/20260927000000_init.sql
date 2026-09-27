-- Flossamer MVP schema (PRD v2.1, section 9).
-- Stores references and short summaries, never full message bodies (section 10).
-- Every table is scoped to a studio and protected by row-level security.

create table studios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users on delete cascade,
  display_name text,
  profile jsonb not null default '{}',            -- services, ideal clients, typical engagements
  voice jsonb,                                    -- VoiceProfile, learned from sent mail
  exclusions jsonb not null default '{"senders":[],"domains":[],"labels":[]}',
  backfill_months int not null default 12 check (backfill_months between 6 and 24),
  briefing_day int not null default 1,            -- 1 = Monday
  stages text[] not null default array['Conversation','Proposal out','Booked','In progress','Wrapped'],
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  provider text not null check (provider in ('gmail')),
  account_email text not null,
  scopes text[] not null,
  checkpoint jsonb,                               -- backfill page token and progress
  sync_state text not null default 'pending' check (sync_state in ('pending','backfilling','live','error','revoked')),
  sync_error text,
  last_synced_at timestamptz,
  revoked_at timestamptz,
  unique (studio_id, provider, account_email)
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  name text not null,
  domain text,
  industry jsonb,                                 -- Inferred<string>
  unique (studio_id, domain)
);

create table people (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  name text not null,
  relationship jsonb not null,                    -- Inferred<RelationshipType>
  referred_by_id uuid references people on delete set null,
  referred_by_source text,                        -- message id that states the intro
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

create table person_emails (
  person_id uuid not null references people on delete cascade,
  studio_id uuid not null references studios on delete cascade,
  email text not null,
  primary key (studio_id, email)
);

create table person_organizations (
  person_id uuid not null references people on delete cascade,
  organization_id uuid not null references organizations on delete cascade,
  primary key (person_id, organization_id)
);

-- One row per business message. Personal mail is recorded only in seen_messages.
create table interactions (
  id text not null,                               -- provider message id
  studio_id uuid not null references studios on delete cascade,
  thread_id text not null,
  at timestamptz not null,
  direction text not null check (direction in ('inbound','outbound')),
  counterpart text not null,
  counterpart_name text,
  person_id uuid references people on delete set null,
  subject text not null default '',
  summary text not null,
  expects_reply boolean not null default false,
  extraction jsonb,                               -- ThreadExtraction: stated fields with quotes
  primary key (studio_id, id)
);
create index interactions_thread on interactions (studio_id, thread_id, at);
create index interactions_person on interactions (studio_id, person_id, at);

-- Idempotency ledger for ingestion: every message id we've looked at, and how it was classed.
create table seen_messages (
  studio_id uuid not null references studios on delete cascade,
  id text not null,
  mail_class text not null check (mail_class in ('business','personal','automated')),
  primary key (studio_id, id)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  title text not null,
  stage text not null,
  service text,
  estimated_value numeric,
  expected_start date,
  next_step text,
  paid_amount numeric,                            -- north-star record (WK-11)
  paid_at date,
  origin_signal_id text
);

create table project_people (
  project_id uuid not null references projects on delete cascade,
  person_id uuid not null references people on delete cascade,
  primary key (project_id, person_id)
);

create table project_threads (
  project_id uuid not null references projects on delete cascade,
  thread_id text not null,
  primary key (project_id, thread_id)
);

create table signals (
  id text not null,                               -- deterministic, e.g. "stalled:<thread>"
  studio_id uuid not null references studios on delete cascade,
  type text not null check (type in ('inquiry','intro','stalled','waiting','reconnect','coming_up')),
  coming_up_kind text check (coming_up_kind in ('repeat_client_cycle','deferred_intent','job_change','slow_season','industry_season','company_news')),
  person_id uuid references people on delete cascade,
  evidence text[] not null check (cardinality(evidence) > 0),
  reason text not null,
  confidence real not null check (confidence between 0 and 1),
  window_opens date,
  reach_out_by date,
  status text not null default 'open' check (status in ('open','done','snoozed','dismissed','wrong')),
  snoozed_until date,
  wrong_reason text,                              -- LD-04, feeds the evaluation set
  created_at timestamptz not null default now(),
  primary key (studio_id, id)
);

-- Activity log (TR-01). Append-only; undo is a new row, not an update.
create table agent_actions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  agent text not null check (agent in ('relationship_keeper','conversation_reader','draft_writer','user')),
  trigger text not null,
  evidence text[] not null default '{}',
  proposed jsonb not null,
  confidence real,
  approval text not null check (approval in ('pending','approved','rejected','undone')),
  reverts uuid references agent_actions,
  at timestamptz not null default now()
);

-- Row-level security: a user sees only their own studio's rows.
alter table studios enable row level security;
create policy own_studio on studios using (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['integrations','organizations','people','person_emails','interactions',
                           'seen_messages','projects','signals','agent_actions']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy own_rows on %I using (studio_id in (select id from studios where owner_id = auth.uid()))', t);
  end loop;
end $$;

-- OAuth tokens live apart from integrations. RLS is on with no policies, so only the
-- service role (server and background jobs) can read or write them.
create table integration_secrets (
  integration_id uuid primary key references integrations on delete cascade,
  refresh_token_encrypted text not null            -- AES-256-GCM with TOKEN_ENCRYPTION_KEY
);
alter table integration_secrets enable row level security;

alter table person_organizations enable row level security;
create policy own_rows on person_organizations
  using (person_id in (select p.id from people p join studios s on s.id = p.studio_id where s.owner_id = auth.uid()));

alter table project_people enable row level security;
create policy own_rows on project_people
  using (project_id in (select p.id from projects p join studios s on s.id = p.studio_id where s.owner_id = auth.uid()));

alter table project_threads enable row level security;
create policy own_rows on project_threads
  using (project_id in (select p.id from projects p join studios s on s.id = p.studio_id where s.owner_id = auth.uid()));
