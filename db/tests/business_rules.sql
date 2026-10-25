-- CRM database rule checks. Run against a freshly migrated database:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/business_rules.sql
-- Everything runs inside a transaction that is rolled back, so nothing is left behind.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set search_path = crm, public;
begin;
select set_config('crm.actor', 'test-suite', true);

create function pg_temp.eqt(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice 'PASS %', label;
end $$;
create function pg_temp.fails(label text, sql text, frag text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(lower(frag) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL % – wrong error: % (%)', label, sqlerrm, sqlstate;
    end if;
    raise notice 'PASS %', label;
    return;
  end;
  raise exception 'FAIL % – expected an error', label;
end $$;

insert into supplier (id, name, email) values (9001, 'Rule Test DMC', 'r@t.example');
insert into lead (id, client_name, destination, travel_start, travel_end, status, quote_amount)
values (9001, 'Rule Test', 'Thailand', today_ist() + 30, today_ist() + 35, 'new_query', 100000);

select pg_temp.eqt('lead number assigned', (select lead_no ~ '^SRQ-\d{5}$' from lead where id = 9001)::text, 'true');
select pg_temp.eqt('stage starts as new query', (select stage from v_lead where id = 9001), 'new_query');
select pg_temp.fails('end before start rejected', $q$insert into lead (client_name, destination, travel_start, travel_end) values ('a','b','2026-12-06','2026-12-01')$q$, 'lead_dates');
select pg_temp.fails('zero travellers rejected', $q$insert into lead (client_name, destination, adults) values ('a','b',0)$q$, 'lead_pax');
select pg_temp.fails('blank client rejected', $q$insert into lead (client_name, destination) values ('  ','b')$q$, 'client_name');
select pg_temp.fails('unknown stage rejected', $q$update lead set status = 'maybe' where id = 9001$q$, 'status');
select pg_temp.fails('bad supplier email rejected', $q$insert into supplier (name, email) values ('x','nope')$q$, 'email');
select pg_temp.fails('duplicate supplier name rejected', $q$insert into supplier (name) values ('rule test dmc')$q$, 'supplier_name_uq');

insert into supplier_quote (lead_id, supplier_id) values (9001, 9001);
select pg_temp.fails('one row per supplier per enquiry', $q$insert into supplier_quote (lead_id, supplier_id) values (9001, 9001)$q$, 'supplier_quote_uq');
select pg_temp.fails('received quote needs an amount', $q$update supplier_quote set status = 'received' where lead_id = 9001$q$, 'supplier_quote_received');
update supplier_quote set status = 'selected', amount = 80000 where lead_id = 9001;
select pg_temp.eqt('margin = price − selected supplier cost', (select margin::text from v_lead where id = 9001), '20000.00');
select pg_temp.fails('supplier in use cannot be deleted', $q$delete from supplier where id = 9001$q$, 'foreign key');

insert into lead_payment (lead_id, kind, amount, paid_on) values (9001, 'advance', 30000, today_ist());
insert into lead_payment (lead_id, kind, amount, paid_on, deleted_at) values (9001, 'final', 70000, today_ist(), now());
select pg_temp.eqt('paid ignores deleted payments', (select paid::text from v_lead where id = 9001), '30000.00');
select pg_temp.eqt('balance due', (select balance_due::text from v_lead where id = 9001), '70000.00');
select pg_temp.fails('zero payment rejected', $q$insert into lead_payment (lead_id, kind, amount, paid_on) values (9001, 'advance', 0, today_ist())$q$, 'amount');

-- stages by date
update lead set status = 'booking_confirmed', travel_start = today_ist() - 1, travel_end = today_ist() + 2 where id = 9001;
select pg_temp.eqt('confirmed + on trip = travelling', (select stage from v_lead where id = 9001), 'travelling');
update lead set travel_start = today_ist() - 9, travel_end = today_ist() - 2 where id = 9001;
select pg_temp.eqt('confirmed + trip over = completed', (select stage from v_lead where id = 9001), 'completed');
update lead set status = 'follow_up' where id = 9001;
select pg_temp.eqt('unconfirmed never shows travelling/completed', (select stage from v_lead where id = 9001), 'follow_up');
update lead set status = 'lost', lost_reason = 'price' where id = 9001;
select pg_temp.eqt('lost stays lost', (select stage from v_lead where id = 9001), 'lost');
select pg_temp.eqt('stage order', (select string_agg(stage_rank(s)::text, ',') from unnest(array['new_query','supplier_mailed','quote_received','quote_shared','follow_up','booking_confirmed','advance_received','final_payment_received','travelling','completed','lost']) s), '1,2,3,4,5,6,7,8,9,10,0');

select pg_temp.fails('enquiries cannot be hard-deleted', $q$delete from lead where id = 9001$q$, 'cannot be permanently deleted');
update lead set deleted_at = now() where id = 9001;
update lead set deleted_at = null where id = 9001;
select pg_temp.eqt('audit: soft delete + restore labelled', (select string_agg(action, ',' order by id) from audit_log where table_name = 'lead' and record_id = '9001' and action in ('soft_delete','restore')), 'soft_delete,restore');
select pg_temp.eqt('audit actor recorded', (select distinct actor from audit_log where table_name = 'lead' and record_id = '9001'), 'test-suite');
select pg_temp.eqt('row level security on every table', (select bool_and(relrowsecurity)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'crm' and c.relkind = 'r' and c.relname <> '_test_marker' and c.relname <> 'schema_migrations'), 'true');

\echo 'ALL CRM RULE TESTS PASSED'
rollback;
