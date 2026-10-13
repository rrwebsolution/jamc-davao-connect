-- JAMC Davao Connect — 0012 demo data marker
--
-- Lets presentation data be told apart from real church records, so it can be
-- removed later without touching anything real (see scripts/demo-remove.mjs).
-- Only tables that hold records get the flag. Rows that hang off them
-- (attendance marks, group memberships, ministry assignments, discipleship
-- history, visitor details) are identified through their parent.
-- Configuration tables (statuses, stages, categories, ministries) are not marked.

alter table public.people add column is_demo boolean not null default false;
alter table public.cell_groups add column is_demo boolean not null default false;
alter table public.attendance_sessions add column is_demo boolean not null default false;
alter table public.follow_ups add column is_demo boolean not null default false;
alter table public.pastoral_care_records add column is_demo boolean not null default false;
alter table public.apprentices add column is_demo boolean not null default false;
alter table public.discipleship_milestones add column is_demo boolean not null default false;
alter table public.events add column is_demo boolean not null default false;
alter table public.giving_records add column is_demo boolean not null default false;
alter table public.expenses add column is_demo boolean not null default false;

create index people_demo_idx on public.people (id) where is_demo;

-- Whether any demo people are loaded. Lets the dashboard say so without
-- exposing anything: it returns a single boolean.
create or replace function public.has_demo_data()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (select 1 from public.people where is_demo);
$$;

revoke execute on function public.has_demo_data() from anon, public;
grant execute on function public.has_demo_data() to authenticated, service_role;
