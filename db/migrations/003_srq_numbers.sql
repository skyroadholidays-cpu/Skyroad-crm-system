-- Migration 003: enquiry numbers become SRQ-00001, SRQ-00002, …
-- Existing enquiries (old SKQ- numbers) are renumbered once, in the order
-- they were created. Safe to run more than once.
set search_path = crm, public;

do $$
begin
  if exists (select 1 from crm.lead where lead_no not like 'SRQ-%')
     and not exists (select 1 from crm.lead where lead_no like 'SRQ-%') then
    update crm.lead l
       set lead_no = 'SRQ-' || lpad(x.n::text, greatest(5, length(x.n::text)), '0')
      from (select id, row_number() over (order by created_at, id) as n from crm.lead) x
     where x.id = l.id;
  end if;
end $$;

create or replace function crm.next_lead_no() returns text language sql volatile as $f$
  select 'SRQ-' || lpad(n::text, greatest(5, length(n::text)), '0') from (select nextval('crm.lead_no_seq') as n) s
$f$;
alter table lead alter column lead_no set default crm.next_lead_no();

-- next number = highest SRQ number + 1 (or 1 when there are none)
select setval('crm.lead_no_seq',
              coalesce((select max(substring(lead_no from 5)::int) from crm.lead where lead_no ~ '^SRQ-\d+$'), 1),
              exists (select 1 from crm.lead where lead_no ~ '^SRQ-\d+$'));
