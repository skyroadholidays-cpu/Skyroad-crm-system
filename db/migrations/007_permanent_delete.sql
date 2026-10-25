-- 007: allow "Delete forever" for enquiries that are already in the Trash.
-- Safe to run more than once.
--  * An enquiry must first be deleted (moved to Trash) in the app; only then can it be removed for good.
--  * Removing it for good also removes its supplier requests, payments and timeline (they belong to it).
--  * The audit log keeps a copy of the removed enquiry.
set search_path = crm, public;

create or replace function crm.lead_no_hard_delete() returns trigger language plpgsql as $$
begin
  if old.deleted_at is null then
    raise exception 'Move the enquiry to Trash first (Delete), then use Delete forever.' using errcode = 'P0001';
  end if;
  return old;
end $$;

drop trigger if exists lead_no_delete on crm.lead;
create trigger lead_no_delete before delete on crm.lead for each row execute function crm.lead_no_hard_delete();
