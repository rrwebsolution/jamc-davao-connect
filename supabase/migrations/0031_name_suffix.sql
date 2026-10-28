-- ============================================================================
-- JAMC Davao Connect — 0031 Name suffix
--
-- People can have a suffix or extension name: Jr., Sr., II, III, IV, and so
-- on. It is part of the full name ("Juan Dela Cruz Jr."), so every list, search,
-- report and selection that shows a name shows it too, without changing them.
-- full_name stays a generated column; only its expression changes (PostgreSQL
-- 17), so the views and the search index built on it stay as they are.
-- ============================================================================

alter table public.people
  add column suffix text
    check (suffix is null or char_length(btrim(suffix)) between 1 and 20);

alter table public.people
  alter column full_name set expression as (
    btrim(first_name) || ' ' || btrim(last_name) || coalesce(' ' || nullif(btrim(suffix), ''), '')
  );

-- The account name follows the member record (0019), suffix included.
drop trigger people_sync_account_name on public.people;
create trigger people_sync_account_name
  after insert or update of first_name, last_name, suffix, user_id on public.people
  for each row execute function public.sync_account_name();

-- The Members and Visitors lists and the edit form read people_directory.
create or replace view public.people_directory
with (security_invoker = true)
as
select
  p.id, p.person_type, p.member_code, p.first_name, p.middle_name, p.last_name,
  p.nickname, p.full_name, p.gender, p.birthdate, p.civil_status, p.contact_number,
  p.email, p.address, p.photo_path, p.date_first_attended, p.membership_date,
  p.membership_status_id, p.baptism_status_id, p.baptism_date, p.discipleship_stage_id,
  p.mentor_id, p.is_active, p.user_id, p.converted_at, p.created_at, p.updated_at,
  p.archived_at,
  ms.name as membership_status_name,
  bs.name as baptism_status_name,
  ds.name as discipleship_stage_name,
  mentor.full_name as mentor_name,
  cg.id as cell_group_id,
  cg.name as cell_group_name,
  leader.full_name as cell_leader_name,
  coalesce((
    select array_agg(mm.ministry_id order by m.name)
    from public.ministry_members mm
    join public.ministries m on m.id = mm.ministry_id
    where mm.person_id = p.id and mm.status = 'active'
  ), '{}') as ministry_ids,
  coalesce((
    select array_agg(m.name order by m.name)
    from public.ministry_members mm
    join public.ministries m on m.id = mm.ministry_id
    where mm.person_id = p.id and mm.status = 'active'
  ), '{}') as ministry_names,
  vp.first_visit_date,
  vp.status as visitor_status,
  vp.invited_by_person_id,
  coalesce(inviter.full_name, vp.invited_by_name) as invited_by,
  vp.attendance_type_id as visit_attendance_type_id,
  vt.name as service_attended,
  vp.prayer_request,
  vp.notes as visitor_notes,
  -- Added in 0031; at the end, as a replaced view may only add columns.
  p.suffix
from public.people p
left join public.membership_statuses ms on ms.id = p.membership_status_id
left join public.baptism_statuses bs on bs.id = p.baptism_status_id
left join public.discipleship_stages ds on ds.id = p.discipleship_stage_id
left join public.people mentor on mentor.id = p.mentor_id
left join public.cell_group_members cgm on cgm.person_id = p.id and cgm.left_at is null
left join public.cell_groups cg on cg.id = cgm.cell_group_id
left join public.people leader on leader.id = cg.leader_id
left join public.visitor_profiles vp on vp.person_id = p.id
left join public.people inviter on inviter.id = vp.invited_by_person_id
left join public.attendance_types vt on vt.id = vp.attendance_type_id;
