-- Industry radar (PRD v2.2, section 6.11).
-- Stores links, titles and one-line summaries only; article text is read in memory and discarded.

alter table studios add column radar_enabled boolean not null default true;
-- IR-02: opt-in to suggest newsletters the user already receives, found from headers alone.
alter table studios add column radar_newsletters boolean not null default false;

create table sources (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  url text not null,
  title text not null,
  origin text not null check (origin in ('suggested','newsletter','user')),
  enabled boolean not null default true,
  last_fetched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (studio_id, url)
);

create table articles (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  source_id uuid not null references sources on delete cascade,
  url text not null,
  title text not null,
  published_at timestamptz,
  summary text,                                   -- one line, only for analyzed posts
  triage text not null default 'pending' check (triage in ('pending','skipped','picked','analyzed')),
  created_at timestamptz not null default now(),
  unique (studio_id, url)
);
create index articles_recent on articles (studio_id, created_at desc);

alter table signals add column link jsonb;       -- {url, title, source} for radar items

alter table signals drop constraint signals_type_check;
alter table signals add constraint signals_type_check
  check (type in ('inquiry','intro','stalled','waiting','reconnect','coming_up','idea'));

alter table signals drop constraint signals_coming_up_kind_check;
alter table signals add constraint signals_coming_up_kind_check
  check (coming_up_kind in ('repeat_client_cycle','deferred_intent','job_change','slow_season','industry_season','company_news','industry_trend'));
