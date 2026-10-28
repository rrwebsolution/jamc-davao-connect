-- ============================================================================
-- JAMC Davao Connect — 0027 Attendance records summary
--
-- The Attendance Records screen shows key figures and charts above the list
-- of records. Both come from the same view with the same filters, so they can
-- never disagree:
--
--   attendance_record_details  → the list (paged, in the app)
--                              → attendance_records_summary(...) (totals, charts)
--
-- The view gains the cell group each person currently belongs to, so records
-- can be filtered and compared by group. The summary runs as the caller
-- (security invoker), so row level security decides what it counts exactly as
-- it decides what the list shows: a cell leader's figures cover their people.
-- ============================================================================

create or replace view public.attendance_record_details
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
  s.cell_group_id,
  -- The person's current cell group (at most one; past memberships are history).
  cgm.cell_group_id as person_cell_group_id,
  cg.name as person_cell_group_name
from public.attendance_records r
join public.attendance_sessions s on s.id = r.session_id and s.archived_at is null
join public.people p on p.id = r.person_id
join public.attendance_statuses st on st.id = r.status_id
join public.attendance_types ty on ty.id = s.attendance_type_id
left join public.cell_group_members cgm on cgm.person_id = p.id and cgm.left_at is null
left join public.cell_groups cg on cg.id = cgm.cell_group_id;

-- ---------------------------------------------------------------------------
-- Totals and chart series for the filtered records. Every filter is optional;
-- p_search is matched against the person's name (the caller escapes it).
-- ---------------------------------------------------------------------------
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
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.attendance_records_summary(date, date, uuid, uuid, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.attendance_records_summary(date, date, uuid, uuid, uuid, uuid, text, text, uuid) to authenticated;
