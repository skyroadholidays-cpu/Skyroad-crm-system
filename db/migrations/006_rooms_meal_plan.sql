-- Migration 006: number of rooms and meal plan on each enquiry. Safe to run more than once.
set search_path = crm, public;

alter table lead add column if not exists rooms int check (rooms is null or rooms between 1 and 500);
alter table lead add column if not exists meal_plan text check (meal_plan is null or length(meal_plan) <= 40);

-- rebuild the enquiry view so it includes the new columns
drop view if exists v_lead;
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
