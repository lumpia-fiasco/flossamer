-- LinkedIn from data the user owns (PRD v2.3, section 6.12). Nothing here comes from LinkedIn directly.

-- LI-06, LI-07: opt-in to read the subject lines of LinkedIn notification emails.
alter table studios add column linkedin_notifications boolean not null default false;
alter table studios add column linkedin_imported_at timestamptz;

create table linkedin_connections (
  studio_id uuid not null references studios on delete cascade,
  profile_url text not null,
  first_name text not null,
  last_name text not null,
  email text,
  company text,
  position text,
  connected_on date,
  person_id uuid references people on delete set null,
  -- email: same address as a known person. name: a suggestion awaiting the user. confirmed: the user said yes.
  match text check (match in ('email','name','confirmed')),
  previous_company text,
  previous_position text,
  changed_at timestamptz,
  imported_at timestamptz not null default now(),
  primary key (studio_id, profile_url)
);
create index linkedin_connections_person on linkedin_connections (studio_id, person_id);
create index linkedin_connections_company on linkedin_connections (studio_id, lower(company));

create table linkedin_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  person_id uuid not null references people on delete cascade,
  kind text not null check (kind in ('new_position','post')),
  text text not null,                             -- from the notification subject line only
  at timestamptz not null,
  message_id text not null,
  unique (studio_id, message_id)
);
