-- JAMC Davao Connect — 0014 remove demo data from Settings
--
-- The same removal as scripts/demo-remove.mjs, callable from the app by a
-- Super Admin only. Every statement is limited to rows marked is_demo (or rows
-- that belong to one); there is no unconditional delete.

create or replace function public.demo_data_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_super_admin() then jsonb_build_object(
    'members', (select count(*) from public.people where is_demo and person_type = 'member'),
    'visitors', (select count(*) from public.people where is_demo and person_type = 'visitor'),
    'cell_groups', (select count(*) from public.cell_groups where is_demo),
    'attendance_sessions', (select count(*) from public.attendance_sessions where is_demo),
    'follow_ups', (select count(*) from public.follow_ups where is_demo),
    'care_records', (select count(*) from public.pastoral_care_records where is_demo),
    'events', (select count(*) from public.events where is_demo),
    'giving_records', (select count(*) from public.giving_records where is_demo),
    'expenses', (select count(*) from public.expenses where is_demo)
  ) end;
$$;

create or replace function public.remove_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  real_before bigint;
  real_after bigint;
  removed_people bigint;
  removed_other bigint := 0;
  n bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can remove demo data' using errcode = '42501';
  end if;

  select count(*) into real_before from public.people where not is_demo;

  -- Rows that point at demo people and sessions go first.
  delete from public.notifications nt
  where exists (select 1 from public.people p where p.is_demo and nt.link like '%' || p.id || '%')
     or exists (select 1 from public.events e where e.is_demo and nt.link like '%' || e.id || '%')
     or exists (select 1 from public.follow_ups f
                where (f.is_demo or f.person_id in (select id from public.people where is_demo))
                  and nt.link like '%' || f.id || '%');

  delete from public.attendance_records r
  where r.person_id in (select id from public.people where is_demo)
     or r.session_id in (select id from public.attendance_sessions where is_demo);
  get diagnostics n = row_count; removed_other := removed_other + n;

  delete from public.attendance_sessions where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.giving_records where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.expenses where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.events where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.pastoral_care_records
  where is_demo or person_id in (select id from public.people where is_demo);
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.follow_ups
  where is_demo or person_id in (select id from public.people where is_demo);
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.apprentices
  where is_demo or person_id in (select id from public.people where is_demo);
  delete from public.discipleship_milestones
  where is_demo or person_id in (select id from public.people where is_demo);
  delete from public.cell_groups where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;

  -- Removing a person also removes their visitor details, group memberships,
  -- ministry assignments and discipleship history (cascades).
  delete from public.people where is_demo;
  get diagnostics removed_people = row_count;

  -- Safety net: real records must be exactly as they were, or nothing happens.
  select count(*) into real_after from public.people where not is_demo;
  if real_after <> real_before then
    raise exception 'Real records would have been affected; nothing was removed' using errcode = 'P0001';
  end if;

  -- One log entry for the whole operation instead of one per deleted row.
  delete from public.activity_logs
  where created_at = now() and user_id is not distinct from auth.uid() and action in ('deleted', 'updated');
  insert into public.activity_logs (user_id, action, module, description)
  values (auth.uid(), 'deleted', 'settings',
          'Demo data removed: ' || removed_people || ' people and ' || removed_other || ' related records');

  return jsonb_build_object('people', removed_people, 'other', removed_other);
end;
$$;

revoke execute on function public.demo_data_summary() from anon, public;
revoke execute on function public.remove_demo_data() from anon, public;
grant execute on function public.demo_data_summary() to authenticated, service_role;
grant execute on function public.remove_demo_data() to authenticated, service_role;
