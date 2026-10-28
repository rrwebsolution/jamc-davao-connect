-- ============================================================================
-- JAMC Davao Connect — 0029 First-time visitors on Attendance Records
--
-- Replaces 0028. A visitor's registration (first visit date and service on
-- their profile) is visitor information, not an attendance mark, so it is no
-- longer turned into one. The triggers and helpers 0028 added are removed;
-- no marks were created by them.
--
-- Instead the Attendance Records summary also counts and lists the first-time
-- visitors registered in the period, from the same visitor profiles the
-- dashboard counts, so the two agree. Their attendance marks, if anyone
-- records them, are counted as attendance as before.
-- ============================================================================

drop trigger if exists visitor_profiles_mark_first_visit on public.visitor_profiles;
drop trigger if exists attendance_sessions_mark_first_visits on public.attendance_sessions;
drop function if exists public.visitor_profiles_mark_first_visit();
drop function if exists public.attendance_sessions_mark_first_visits();
drop function if exists public.backfill_first_visit_marks(boolean);
drop function if exists public.mark_first_visit(uuid);
drop function if exists public.first_visit_session(date, uuid);
drop function if exists public.present_status_id();

create or replace function public.attendance_records_summary(
  p_from date default null,
  p_to date default null,
  p_type uuid default null,
  p_status uuid default null,
  p_group uuid default null,
  p_session uuid default null,
  p_person_type text default null,
  p_search text default null,
  p_person uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with r as (
    select d.*
    from public.attendance_record_details d
    where (p_from is null or d.session_date >= p_from)
      and (p_to is null or d.session_date <= p_to)
      and (p_type is null or d.attendance_type_id = p_type)
      and (p_status is null or d.status_id = p_status)
      and (p_group is null or d.person_cell_group_id = p_group)
      and (p_session is null or d.session_id = p_session)
      and (p_person_type is null or d.person_type = p_person_type)
      and (p_search is null or d.person_name ilike '%' || p_search || '%')
      and (p_person is null or d.person_id = p_person)
  ), v as (
    -- First-time visitors registered in the period (the visit details on their
    -- profile), counted the way the dashboard counts them: whether or not
    -- anyone was marked in attendance. Filters that only make sense for marks
    -- (a status) leave none; the others narrow them the same way.
    select vp.person_id, vp.first_visit_date, p.full_name, p.person_type, p.archived_at, ty.name as service_name
    from public.visitor_profiles vp
    join public.people p on p.id = vp.person_id
    left join public.attendance_types ty on ty.id = vp.attendance_type_id
    left join public.cell_group_members cgm on cgm.person_id = p.id and cgm.left_at is null
    where vp.first_visit_date is not null
      and p_status is null
      and (p_person_type is null or p_person_type = 'visitor')
      and (p_from is null or vp.first_visit_date >= p_from)
      and (p_to is null or vp.first_visit_date <= p_to)
      and (p_type is null or vp.attendance_type_id = p_type)
      and (p_group is null or cgm.cell_group_id = p_group)
      and (p_session is null or exists (
        select 1 from public.attendance_sessions s
        where s.id = p_session and s.session_date = vp.first_visit_date and s.attendance_type_id = vp.attendance_type_id
      ))
      and (p_search is null or p.full_name ilike '%' || p_search || '%')
      and (p_person is null or vp.person_id = p_person)
  )
  select jsonb_build_object(
    'marks', (select count(*) from r),
    'present', (select count(*) from r where r.counts_as_present),
    'absent', (select count(*) from r where not r.counts_as_present),
    'sessions', (select count(distinct r.session_id) from r),
    'members_present', (select count(*) from r where r.counts_as_present and r.person_type = 'member'),
    'visitors_present', (select count(*) from r where r.counts_as_present and r.person_type = 'visitor'),
    'unique_visitors', (select count(distinct r.person_id) from r where r.counts_as_present and r.person_type = 'visitor'),
    -- One point per date: everyone present that day, members and visitors apart.
    'trend', coalesce((
      select jsonb_agg(t order by t.date)
      from (
        select r.session_date as date,
          count(*) filter (where r.counts_as_present and r.person_type = 'member') as members,
          count(*) filter (where r.counts_as_present and r.person_type = 'visitor') as visitors,
          count(*) filter (where not r.counts_as_present) as absent,
          count(distinct r.session_id) as sessions,
          -- The session when the day had only one, so a click can open it.
          case when count(distinct r.session_id) = 1 then min(r.session_id::text) end as session_id
        from r
        group by r.session_date
      ) t
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(t order by t.sort_order, t.name)
      from (
        select r.status_id as id, r.status_name as name, bool_or(r.counts_as_present) as counts_as_present,
          count(*) as total, min(st.sort_order) as sort_order
        from r
        join public.attendance_statuses st on st.id = r.status_id
        group by r.status_id, r.status_name
      ) t
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(t order by t.name)
      from (
        select r.person_cell_group_id as id, r.person_cell_group_name as name,
          count(*) filter (where r.counts_as_present) as present,
          count(*) as total
        from r
        where r.person_cell_group_id is not null
        group by r.person_cell_group_id, r.person_cell_group_name
      ) t
    ), '[]'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(t order by t.month)
      from (
        select date_trunc('month', r.session_date)::date as month,
          count(*) filter (where r.counts_as_present and r.person_type = 'member') as members,
          count(*) filter (where r.counts_as_present and r.person_type = 'visitor') as visitors
        from r
        group by 1
      ) t
    ), '[]'::jsonb),
    'new_visitors', (select count(*) from v),
    -- The latest few, for the list on the page; whether they were also marked present that day.
    'first_visitors', coalesce((
      select jsonb_agg(t order by t.first_visit_date desc, t.full_name)
      from (
        select v.person_id as id, v.full_name, v.first_visit_date, v.service_name, v.person_type,
          v.archived_at is not null as archived,
          exists (
            select 1 from public.attendance_record_details d
            where d.person_id = v.person_id and d.session_date = v.first_visit_date and d.counts_as_present
          ) as marked_present
        from v
        order by v.first_visit_date desc, v.full_name
        limit 8
      ) t
    ), '[]'::jsonb)
  );
$$;

