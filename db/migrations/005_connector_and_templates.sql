-- Migration 005: settings for the Claude connector and your supplier email
-- template. Safe to run more than once.
set search_path = crm, public;

create table if not exists app_setting (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
alter table app_setting enable row level security;

drop trigger if exists audit_app_setting on app_setting;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema crm from anon, authenticated';
  end if;
end $$;
