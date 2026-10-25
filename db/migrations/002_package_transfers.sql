-- Migration 002: adds "Transfers" as a package type. Safe to run more than once.
set search_path = crm, public;
alter table lead drop constraint if exists lead_package_type_check;
alter table lead add constraint lead_package_type_check
  check (package_type is null or package_type in ('land_package','hotel_only','transfers','flights_only','visa_only','custom'));
