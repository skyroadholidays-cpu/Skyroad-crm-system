-- Migration 004: enquiry numbers with no gaps (SRQ-00001, 00002, 00003 …).
-- A number is taken only when an enquiry is actually saved, so a failed save
-- can no longer skip one. Also closes any existing gaps, keeping the order the
-- enquiries were created in. Safe to run more than once.
set search_path = crm, public;

create or replace function crm.assign_lead_no() returns trigger language plpgsql as $$
declare n int;
begin
  if new.lead_no is not null and new.lead_no <> '' then return new; end if;
  -- one enquiry at a time takes the next number (released when the save finishes)
  perform pg_advisory_xact_lock(hashtext('crm.lead_no'));
  select coalesce(max(substring(lead_no from 5)::int), 0) + 1 into n from crm.lead where lead_no ~ '^SRQ-\d+$';
  new.lead_no := 'SRQ-' || lpad(n::text, greatest(5, length(n::text)), '0');
  return new;
end $$;

alter table lead alter column lead_no drop default;
drop trigger if exists lead_assign_no on lead;
create trigger lead_assign_no before insert on lead for each row execute function crm.assign_lead_no();

-- close gaps: renumber in creation order (only rows whose number would change)
do $$
begin
  if exists (
    select 1 from (select lead_no, row_number() over (order by created_at, id) as n from crm.lead) x
    where x.lead_no <> 'SRQ-' || lpad(x.n::text, greatest(5, length(x.n::text)), '0')) then
    update crm.lead set lead_no = 'TMP-' || id;
    update crm.lead l
       set lead_no = 'SRQ-' || lpad(x.n::text, greatest(5, length(x.n::text)), '0')
      from (select id, row_number() over (order by created_at, id) as n from crm.lead) x
     where x.id = l.id;
  end if;
end $$;
