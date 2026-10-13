-- JAMC Davao Connect — 0006 dashboard and attendance statistics
--
-- These are SECURITY INVOKER on purpose: they run with the caller's rights, so
-- every number is already filtered by RLS. A cell leader's dashboard counts
-- only the people they are allowed to see.

create or replace function public.church_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select timezone from public.church_settings limit 1), 'Asia/Manila'))::date;
$$;

create or replace function public.dashboard_stats()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with t as (
    select public.church_today() as today
  ),
  m as (
    select
      date_trunc('month', today)::date as cur,
      (date_trunc('month', today) - interval '1 month')::date as prev,
      (date_trunc('month', today) + interval '1 month')::date as nxt
    from t
  ),
  members as (
    select * from public.people where person_type = 'member' and archived_at is null
  ),
  main_sessions as (
    select
      s.id, s.session_date, s.title, s.created_at,
      (select count(*) from public.attendance_records r
         join public.attendance_statuses st on st.id = r.status_id
        where r.session_id = s.id and st.counts_as_present) as present,
      (select count(*) from public.attendance_records r
         join public.attendance_statuses st on st.id = r.status_id
        where r.session_id = s.id and not st.counts_as_present) as absent
    from public.attendance_sessions s
    join public.attendance_types ty on ty.id = s.attendance_type_id
    cross join t
    where ty.counts_for_absence and s.archived_at is null and s.session_date <= t.today
    order by s.session_date desc, s.created_at desc
    limit 12
  ),
  ranked_sessions as (
    select *, row_number() over (order by session_date desc, created_at desc) as rn
    from main_sessions
  ),
  months as (
    select generate_series(m.cur - interval '11 months', m.cur, interval '1 month')::date as month_start
    from m
  )
  select jsonb_build_object(
    'today', (select today from t),
    'total_members', (select count(*) from members),
    'active_members', (select count(*) from members where is_active),
    'new_members_this_month', (
      select count(*) from members, m where membership_date >= m.cur and membership_date < m.nxt
    ),
    'new_members_last_month', (
      select count(*) from members, m where membership_date >= m.prev and membership_date < m.cur
    ),
    'new_visitors_this_month', (
      select count(*) from public.visitor_profiles v, m
      where v.first_visit_date >= m.cur and v.first_visit_date < m.nxt
    ),
    'new_visitors_last_month', (
      select count(*) from public.visitor_profiles v, m
      where v.first_visit_date >= m.prev and v.first_visit_date < m.cur
    ),
    'latest_service', (
      select jsonb_build_object('id', id, 'title', title, 'date', session_date, 'present', present)
      from ranked_sessions where rn = 1
    ),
    'previous_service', (
      select jsonb_build_object('id', id, 'title', title, 'date', session_date, 'present', present)
      from ranked_sessions where rn = 2
    ),
    'active_cell_groups', (
      select count(*) from public.cell_groups where is_active and archived_at is null
    ),
    'attendance_trend', coalesce((
      select jsonb_agg(
        jsonb_build_object('date', session_date, 'title', title, 'present', present, 'absent', absent)
        order by session_date, created_at
      )
      from main_sessions
    ), '[]'::jsonb),
    'membership_growth', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'month', month_start,
          'new_members', (
            select count(*) from members
            where membership_date >= month_start
              and membership_date < month_start + interval '1 month'
          ),
          'total_members', (
            select count(*) from members
            where coalesce(membership_date, created_at::date) < month_start + interval '1 month'
          )
        )
        order by month_start
      )
      from months
    ), '[]'::jsonb),
    'visitor_trend', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'month', month_start,
          'visitors', (
            select count(*) from public.visitor_profiles v
            where v.first_visit_date >= month_start
              and v.first_visit_date < month_start + interval '1 month'
          )
        )
        order by month_start
      )
      from months
    ), '[]'::jsonb),
    'cell_group_participation', coalesce((
      select jsonb_agg(jsonb_build_object('name', g.name, 'members', g.member_count) order by g.name)
      from (
        select cg.name,
          (select count(*) from public.cell_group_members cm
            where cm.cell_group_id = cg.id and cm.left_at is null) as member_count
        from public.cell_groups cg
        where cg.is_active and cg.archived_at is null
      ) g
    ), '[]'::jsonb),
    'discipleship_progress', coalesce((
      select jsonb_agg(jsonb_build_object('stage', d.name, 'members', d.member_count) order by d.sort_order)
      from (
        select ds.name, ds.sort_order,
          (select count(*) from members mm where mm.discipleship_stage_id = ds.id) as member_count
        from public.discipleship_stages ds
        where ds.is_active
      ) d
    ), '[]'::jsonb)
  );
$$;

-- Members whose birthday falls within the next N days (church timezone).
-- Adding whole years to the birthdate maps Feb 29 onto Feb 28 in common years.
create or replace function public.upcoming_birthdays(days_ahead integer default 30)
returns table (
  id uuid,
  full_name text,
  photo_path text,
  birthdate date,
  next_birthday date,
  turning_age integer
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.full_name, p.photo_path, p.birthdate, n.next_birthday,
         (extract(year from n.next_birthday) - extract(year from p.birthdate))::integer
  from public.people p
  cross join lateral (select public.church_today() as today) t
  cross join lateral (
    select (extract(year from t.today) - extract(year from p.birthdate))::integer as years
  ) y
  cross join lateral (
    select case
      when (p.birthdate + make_interval(years => y.years))::date >= t.today
        then (p.birthdate + make_interval(years => y.years))::date
      else (p.birthdate + make_interval(years => y.years + 1))::date
    end as next_birthday
  ) n
  where p.person_type = 'member'
    and p.archived_at is null
    and p.is_active
    and p.birthdate is not null
    and n.next_birthday <= t.today + greatest(days_ahead, 0)
  order by n.next_birthday, p.full_name;
$$;

-- One person's attendance summary. Consecutive absences are counted over the
-- attendance types flagged counts_for_absence, newest session first.
create or replace function public.person_attendance_stats(target_person_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with recs as (
    select s.session_date, s.created_at, st.counts_as_present, ty.counts_for_absence
    from public.attendance_records r
    join public.attendance_sessions s on s.id = r.session_id
    join public.attendance_statuses st on st.id = r.status_id
    join public.attendance_types ty on ty.id = s.attendance_type_id
    where r.person_id = target_person_id and s.archived_at is null
  ),
  main_recs as (
    select counts_as_present,
           row_number() over (order by session_date desc, created_at desc) as rn
    from recs where counts_for_absence
  ),
  months as (
    select generate_series(
      date_trunc('month', public.church_today()) - interval '5 months',
      date_trunc('month', public.church_today()),
      interval '1 month'
    )::date as month_start
  )
  select jsonb_build_object(
    'total', (select count(*) from recs),
    'present', (select count(*) from recs where counts_as_present),
    'absent', (select count(*) from recs where not counts_as_present),
    'attendance_rate', (
      select case when count(*) = 0 then null
        else round(100.0 * count(*) filter (where counts_as_present) / count(*), 1) end
      from recs
    ),
    'consecutive_absences', coalesce(
      (select min(rn) - 1 from main_recs where counts_as_present),
      (select count(*) from main_recs)
    ),
    'last_attended', (select max(session_date) from recs where counts_as_present),
    'monthly', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'month', month_start,
          'present', (
            select count(*) from recs
            where counts_as_present
              and session_date >= month_start and session_date < month_start + interval '1 month'
          ),
          'absent', (
            select count(*) from recs
            where not counts_as_present
              and session_date >= month_start and session_date < month_start + interval '1 month'
          )
        )
        order by month_start
      )
      from months
    ), '[]'::jsonb)
  );
$$;

-- Per-session totals for the Services list.
create or replace function public.attendance_session_totals(session_ids uuid[])
returns table (session_id uuid, present bigint, absent bigint, total bigint)
language sql
stable
set search_path = ''
as $$
  select r.session_id,
         count(*) filter (where st.counts_as_present),
         count(*) filter (where not st.counts_as_present),
         count(*)
  from public.attendance_records r
  join public.attendance_statuses st on st.id = r.status_id
  where r.session_id = any (session_ids)
  group by r.session_id;
$$;

-- ---------------------------------------------------------------------------
-- Flat, filterable view of people for the Members and Visitors lists.
-- security_invoker makes it obey the caller's RLS on every joined table.
-- ---------------------------------------------------------------------------
create view public.people_directory
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
  vp.notes as visitor_notes
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

-- Flat view of attendance records for the Records and History screens.
create view public.attendance_record_details
with (security_invoker = true)
as
select
  r.id, r.session_id, r.person_id, r.status_id, r.notes,
  p.full_name as person_name,
  p.person_type,
  st.name as status_name,
  st.counts_as_present,
  s.title as session_title,
  s.session_date,
  s.created_at as session_created_at,
  s.attendance_type_id,
  ty.name as attendance_type_name,
  s.cell_group_id
from public.attendance_records r
join public.attendance_sessions s on s.id = r.session_id and s.archived_at is null
join public.people p on p.id = r.person_id
join public.attendance_statuses st on st.id = r.status_id
join public.attendance_types ty on ty.id = s.attendance_type_id;
