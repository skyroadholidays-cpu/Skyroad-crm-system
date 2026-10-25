-- Skyroad Holidays – CRM
-- Migration 001: complete schema. Safe to run more than once.
--
-- Design
--  * One row per enquiry ("lead"). Its stage moves forward through the sales
--    pipeline: new query → supplier mail sent → quote received → quote shared
--    → follow-up → booking confirmed → advance → final payment → travelling
--    → completed  (or "lost" at any point).
--  * The app moves the stage forward automatically when you record the event
--    (mail a supplier, log a quote, share a quote, record a payment…).
--    "Travelling" and "Completed" are worked out from the travel dates every
--    time a page loads, so they are never out of date.
--  * Every change is written to an audit log; deletes are soft and restorable.
--  * Everything lives in its own schema "crm" so Supabase's public REST API
--    never exposes it; row level security is enabled as a second lock.

create schema if not exists crm;
set search_path = crm, public;

-- ───────────────────────────── auth ─────────────────────────────
create table if not exists app_user (
  id                  serial primary key,
  username            text not null,
  password_hash       text,
  password_changed_at timestamptz,
  created_at          timestamptz not null default now()
);
create unique index if not exists app_user_username_uq on app_user (lower(username));
insert into app_user (username)
select 'Skyroadholidays' where not exists (select 1 from app_user where lower(username) = 'skyroadholidays');

create table if not exists session (
  id           text primary key,
  user_id      int  not null references app_user(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text,
  ip           text
);
create index if not exists session_user_idx on session(user_id);

create table if not exists login_attempt (
  id       bigserial primary key,
  username text,
  ip       text,
  success  boolean not null,
  at       timestamptz not null default now()
);
create index if not exists login_attempt_at_idx on login_attempt(at);

-- ───────────────────────────── stages ─────────────────────────────
create or replace function stage_rank(s text) returns int language sql immutable as $$
  select case s
    when 'new_query' then 1 when 'supplier_mailed' then 2 when 'quote_received' then 3
    when 'quote_shared' then 4 when 'follow_up' then 5 when 'booking_confirmed' then 6
    when 'advance_received' then 7 when 'final_payment_received' then 8
    when 'travelling' then 9 when 'completed' then 10 when 'lost' then 0 end
$$;

create or replace function today_ist() returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- ───────────────────────────── suppliers ─────────────────────────────
create table if not exists supplier (
  id             serial primary key,
  name           text not null check (length(trim(name)) between 1 and 120),
  contact_person text,
  email          text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone          text,
  whatsapp       text,
  destinations   text,           -- e.g. "Thailand, Bali, Vietnam"
  services       text,           -- e.g. "Land packages, hotels, transfers"
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists supplier_name_uq on supplier (lower(name));

-- ───────────────────────────── leads ─────────────────────────────
create sequence if not exists lead_no_seq start 101;

create table if not exists lead (
  id              serial primary key,
  lead_no         text not null unique default ('SKQ-' || lpad(nextval('crm.lead_no_seq')::text, 5, '0')),
  status          text not null default 'new_query' check (status in (
                    'new_query','supplier_mailed','quote_received','quote_shared','follow_up',
                    'booking_confirmed','advance_received','final_payment_received','travelling','completed','lost')),
  priority        text not null default 'normal' check (priority in ('hot','normal','cold')),
  -- client
  client_name     text not null check (length(trim(client_name)) between 1 and 120),
  phone           text,
  email           text,
  city            text,
  lead_source     text,
  -- trip
  destination     text not null check (length(trim(destination)) between 1 and 120),
  trip_type       text check (trip_type is null or trip_type in ('domestic','international')),
  travel_start    date,
  travel_end      date,
  flexible_dates  boolean not null default false,
  adults          int not null default 2 check (adults between 0 and 999),
  children        int not null default 0 check (children between 0 and 999),
  child_ages      text,
  infants         int not null default 0 check (infants between 0 and 999),
  nights_plan     text,          -- e.g. "2N Krabi, 3N Phuket"
  hotel_category  text,          -- e.g. "4 Star"
  package_type    text check (package_type is null or package_type in ('land_package','hotel_only','custom','flights_only','visa_only')),
  inclusions      text[] not null default '{}',
  budget          numeric(14,2) check (budget is null or (budget >= 0 and budget < 1e12)),
  budget_basis    text not null default 'total' check (budget_basis in ('total','per_person')),
  requirements    text,
  -- selling
  quote_amount    numeric(14,2) check (quote_amount is null or (quote_amount > 0 and quote_amount < 1e12)),
  itinerary_url   text,
  quote_shared_at timestamptz,
  booking_ref     text,
  confirmed_at    timestamptz,
  next_follow_up  date,
  follow_up_note  text,
  lost_reason     text,
  closed_at       timestamptz,
  notes           text,
  idempotency_key text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      text,
  updated_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  constraint lead_dates check (travel_end is null or travel_start is null or travel_end >= travel_start),
  constraint lead_pax check (adults + children + infants > 0)
);
create index if not exists lead_status_idx on lead(status) where deleted_at is null;
create index if not exists lead_follow_idx on lead(next_follow_up) where deleted_at is null;
create index if not exists lead_start_idx on lead(travel_start) where deleted_at is null;
create unique index if not exists lead_booking_ref_uq on lead (lower(booking_ref)) where booking_ref is not null and deleted_at is null;

-- One row per supplier asked for a quote on a lead.
create table if not exists supplier_quote (
  id           serial primary key,
  lead_id      int not null references lead(id) on delete cascade,
  supplier_id  int not null references supplier(id) on delete restrict,
  channel      text not null default 'email' check (channel in ('email','whatsapp','phone','portal')),
  requested_at timestamptz not null default now(),
  status       text not null default 'requested' check (status in ('requested','received','declined','selected')),
  amount       numeric(14,2) check (amount is null or (amount > 0 and amount < 1e12)),
  currency     text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  received_at  timestamptz,
  valid_until  date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint supplier_quote_received check (status not in ('received','selected') or amount is not null)
);
create unique index if not exists supplier_quote_uq on supplier_quote(lead_id, supplier_id);
-- only one selected supplier per lead
create unique index if not exists supplier_quote_one_selected on supplier_quote(lead_id) where status = 'selected';

-- Payments received from the client (for the CRM's own tracking; the cash
-- system stays the record of physical cash).
create table if not exists lead_payment (
  id         serial primary key,
  lead_id    int not null references lead(id) on delete cascade,
  kind       text not null check (kind in ('advance','final','other')),
  amount     numeric(14,2) not null check (amount > 0 and amount < 1e12),
  paid_on    date not null,
  mode       text,               -- Cash, UPI, Bank transfer, Card…
  reference  text,
  notes      text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists lead_payment_lead_idx on lead_payment(lead_id) where deleted_at is null;

-- Timeline: notes, calls, WhatsApps, mails and automatic stage changes.
create table if not exists activity (
  id      bigserial primary key,
  lead_id int not null references lead(id) on delete cascade,
  kind    text not null check (kind in ('note','call','whatsapp','email','meeting','stage','supplier','quote','payment','follow_up','system')),
  body    text not null,
  at      timestamptz not null default now(),
  actor   text,
  meta    jsonb
);
create index if not exists activity_lead_idx on activity(lead_id, at desc);
create index if not exists activity_at_idx on activity(at desc);

-- ───────────────────────────── audit ─────────────────────────────
create table if not exists audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text,
  table_name text not null,
  record_id  text not null,
  action     text not null,
  old_data   jsonb,
  new_data   jsonb
);
create index if not exists audit_log_record_idx on audit_log(table_name, record_id);
create index if not exists audit_log_at_idx on audit_log(at desc);

create or replace function audit_row() returns trigger language plpgsql as $$
declare
  act text := lower(tg_op);
  rid text;
begin
  if tg_op = 'DELETE' then rid := old.id::text; else rid := new.id::text; end if;
  if tg_op = 'UPDATE' and tg_table_name in ('lead', 'lead_payment') then
    if old.deleted_at is null and new.deleted_at is not null then act := 'soft_delete';
    elsif old.deleted_at is not null and new.deleted_at is null then act := 'restore';
    end if;
  end if;
  insert into crm.audit_log(actor, table_name, record_id, action, old_data, new_data)
  values (nullif(current_setting('crm.actor', true), ''), tg_table_name, rid, act,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['lead','supplier','supplier_quote','lead_payment'] loop
    execute format('drop trigger if exists audit_%1$s on crm.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on crm.%1$s for each row execute function crm.audit_row()', t);
    execute format('drop trigger if exists touch_%1$s on crm.%1$s', t);
    execute format('create trigger touch_%1$s before update on crm.%1$s for each row execute function crm.touch_updated_at()', t);
  end loop;
end $$;

-- Leads are never hard-deleted (use delete in the app – it can be restored).
create or replace function lead_no_hard_delete() returns trigger language plpgsql as $$
begin
  raise exception 'Enquiries cannot be permanently deleted; use Delete in the app (it can be restored).' using errcode = 'P0001';
end $$;
drop trigger if exists lead_no_delete on lead;
create trigger lead_no_delete before delete on lead for each row execute function lead_no_hard_delete();

-- ───────────────────────────── views ─────────────────────────────
create or replace view v_lead as
select l.*,
  -- the stage you see: confirmed trips switch to Travelling / Completed by date
  case
    when l.status in ('lost', 'completed') then l.status
    when stage_rank(l.status) >= 6 and l.travel_start is not null
         and today_ist() > coalesce(l.travel_end, l.travel_start) then 'completed'
    when stage_rank(l.status) >= 6 and l.travel_start is not null
         and today_ist() >= l.travel_start then 'travelling'
    else l.status
  end as stage,
  (l.travel_end - l.travel_start) as nights,
  (l.adults + l.children + l.infants) as pax,
  coalesce(p.paid, 0)::numeric(14,2) as paid,
  coalesce(p.advance, 0)::numeric(14,2) as advance_paid,
  p.last_paid_on,
  case when l.quote_amount is null then null else (l.quote_amount - coalesce(p.paid, 0))::numeric(14,2) end as balance_due,
  coalesce(q.requested, 0) as quotes_requested,
  coalesce(q.received, 0) as quotes_received,
  q.best_amount as best_quote,
  q.selected_amount as supplier_cost,
  q.selected_supplier,
  case when l.quote_amount is not null and q.selected_amount is not null
       then (l.quote_amount - q.selected_amount)::numeric(14,2) end as margin,
  a.last_activity_at,
  (l.next_follow_up is not null and l.next_follow_up < today_ist()) as follow_up_overdue
from lead l
left join lateral (
  select sum(amount) as paid, sum(amount) filter (where kind = 'advance') as advance, max(paid_on) as last_paid_on
  from lead_payment where lead_id = l.id and deleted_at is null
) p on true
left join lateral (
  select count(*)::int as requested,
         count(*) filter (where status in ('received','selected'))::int as received,
         min(amount) filter (where status in ('received','selected') and currency = 'INR') as best_amount,
         max(amount) filter (where status = 'selected' and currency = 'INR') as selected_amount,
         max(s.name) filter (where sq.status = 'selected') as selected_supplier
  from supplier_quote sq join supplier s on s.id = sq.supplier_id where sq.lead_id = l.id
) q on true
left join lateral (select max(at) as last_activity_at from activity where lead_id = l.id) a on true;

-- ───────────────────────────── security ─────────────────────────────
alter table app_user       enable row level security;
alter table session        enable row level security;
alter table login_attempt  enable row level security;
alter table supplier       enable row level security;
alter table lead           enable row level security;
alter table supplier_quote enable row level security;
alter table lead_payment   enable row level security;
alter table activity       enable row level security;
alter table audit_log      enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema crm from anon, authenticated';
    execute 'revoke all on all tables in schema crm from anon, authenticated';
  end if;
end $$;
