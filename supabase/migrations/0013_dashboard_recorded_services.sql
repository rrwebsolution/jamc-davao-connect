-- JAMC Davao Connect — 0013 dashboard: ignore services with no attendance recorded yet
--
-- A service that was created but not yet marked used to count as the latest
-- service with 0 present, which showed "0" and a -100% trend on the dashboard.

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
      -- A session nobody has been marked in yet is "not recorded", not "zero attended".
      and exists (select 1 from public.attendance_records r where r.session_id = s.id)
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
