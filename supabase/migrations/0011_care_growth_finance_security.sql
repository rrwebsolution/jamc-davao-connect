-- JAMC Davao Connect — 0011 permissions, RLS, functions and seed for Phases 2-4

-- ---------------------------------------------------------------------------
-- New permissions (scoped variants for cell leaders)
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module, description, sort_order) values
  ('groups.manage_assigned', 'Cell Groups', 'Update the cell groups they lead and remove members', 42),
  ('care.view_assigned', 'Care', 'View follow-ups for people in the cell groups they lead', 53),
  ('care.manage_assigned', 'Care', 'Create and update follow-ups for people in the cell groups they lead', 54),
  ('discipleship.view_assigned', 'Discipleship', 'View discipleship of people they lead or mentor', 62),
  ('discipleship.manage_assigned', 'Discipleship', 'Update discipleship of people they lead or mentor', 63)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'groups.manage_assigned', 'care.view_assigned', 'care.manage_assigned',
  'discipleship.view_assigned', 'discipleship.manage_assigned'
)
where r.key in ('cell_leader', 'super_admin')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.has_care_access(target_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pastoral_care_access a
    where a.record_id = target_record_id and a.user_id = auth.uid()
  );
$$;

-- The single definition of who may read a pastoral care record.
create or replace function public.can_view_care_record(
  record_id uuid, confidentiality text, assigned_to uuid, created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and (
    assigned_to = auth.uid()
    or created_by = auth.uid()
    or public.has_permission('care.confidential')
    or (confidentiality = 'care_team' and public.has_permission('care.view'))
    or (confidentiality = 'selected_leaders' and public.has_care_access(record_id))
  );
$$;

create or replace function public.owns_care_record(target_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission('care.confidential') or exists (
    select 1 from public.pastoral_care_records r
    where r.id = target_record_id and r.created_by = auth.uid()
  );
$$;

create or replace function public.has_care_record_for(target_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pastoral_care_records r
    where r.person_id = target_person_id and r.assigned_to = auth.uid()
  );
$$;

create or replace function public.session_event_id(target_session_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.event_id from public.attendance_sessions s where s.id = target_session_id;
$$;

-- ---------------------------------------------------------------------------
-- Existing tables: extra access for the new modules
-- ---------------------------------------------------------------------------

-- A person is visible to whoever is assigned their follow-up or care record,
-- and to their mentor.
create policy people_select_related on public.people for select to authenticated
  using (
    public.has_follow_up_for(id)
    or public.has_care_record_for(id)
    or ((select public.has_permission('discipleship.view_assigned')) and mentor_id = (select public.current_person_id()))
  );

-- Cell leaders may update the groups they lead (which columns: guard below).
create policy cell_groups_update_assigned on public.cell_groups for update to authenticated
  using ((select public.has_permission('groups.manage_assigned')) and public.leads_group(id))
  with check ((select public.has_permission('groups.manage_assigned')) and public.leads_group(id));

create or replace function public.guard_cell_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.has_permission('groups.manage') then
    return new;
  end if;
  if new.name is distinct from old.name
     or new.leader_id is distinct from old.leader_id
     or new.assistant_leader_id is distinct from old.assistant_leader_id
     or new.is_active is distinct from old.is_active
     or new.archived_at is distinct from old.archived_at then
    raise exception 'Only group managers can rename, reassign or archive a cell group'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger cell_groups_guard before update on public.cell_groups
  for each row execute function public.guard_cell_groups();

-- Leaders may end a membership in their own group (set left_at).
create policy cell_group_members_update_assigned on public.cell_group_members for update to authenticated
  using ((select public.has_permission('groups.manage_assigned')) and public.leads_group(cell_group_id))
  with check ((select public.has_permission('groups.manage_assigned')) and public.leads_group(cell_group_id));

-- Event managers may run the attendance session linked to an event.
create policy attendance_sessions_events on public.attendance_sessions for all to authenticated
  using (event_id is not null and (select public.has_permission('events.manage')))
  with check (event_id is not null and (select public.has_permission('events.manage')));

create policy attendance_records_events on public.attendance_records for all to authenticated
  using ((select public.has_permission('events.manage')) and public.session_event_id(session_id) is not null)
  with check ((select public.has_permission('events.manage')) and public.session_event_id(session_id) is not null);

-- ---------------------------------------------------------------------------
-- RLS for the new tables
-- ---------------------------------------------------------------------------
alter table public.follow_ups enable row level security;
alter table public.pastoral_care_records enable row level security;
alter table public.pastoral_care_access enable row level security;
alter table public.apprentices enable row level security;
alter table public.notifications enable row level security;
alter table public.discipleship_records enable row level security;
alter table public.discipleship_milestones enable row level security;
alter table public.mentor_relationships enable row level security;
alter table public.events enable row level security;
alter table public.giving_categories enable row level security;
alter table public.expense_categories enable row level security;
alter table public.giving_records enable row level security;
alter table public.expenses enable row level security;

-- Follow-ups
create policy follow_ups_select on public.follow_ups for select to authenticated
  using (
    (select public.has_permission('care.view'))
    or assigned_to = (select auth.uid())
    or created_by = (select auth.uid())
    or ((select public.has_permission('care.view_assigned')) and public.leads_person(person_id))
  );
create policy follow_ups_insert on public.follow_ups for insert to authenticated
  with check (
    (select public.has_permission('care.manage'))
    or ((select public.has_permission('care.manage_assigned')) and public.leads_person(person_id))
  );
create policy follow_ups_update on public.follow_ups for update to authenticated
  using (
    (select public.has_permission('care.manage'))
    or assigned_to = (select auth.uid())
    or ((select public.has_permission('care.manage_assigned')) and public.leads_person(person_id))
  )
  with check (
    (select public.has_permission('care.manage'))
    or assigned_to = (select auth.uid())
    or created_by = (select auth.uid())
    or ((select public.has_permission('care.manage_assigned')) and public.leads_person(person_id))
  );
create policy follow_ups_delete on public.follow_ups for delete to authenticated
  using ((select public.has_permission('care.manage')));

-- Pastoral care: confidentiality is decided here, in the database.
create policy pastoral_care_select on public.pastoral_care_records for select to authenticated
  using (public.can_view_care_record(id, confidentiality, assigned_to, created_by));
create policy pastoral_care_insert on public.pastoral_care_records for insert to authenticated
  with check ((select public.has_permission('care.manage')));
create policy pastoral_care_update on public.pastoral_care_records for update to authenticated
  using (
    public.can_view_care_record(id, confidentiality, assigned_to, created_by)
    and ((select public.has_permission('care.manage')) or created_by = (select auth.uid()))
  )
  with check ((select public.has_permission('care.manage')) or created_by = (select auth.uid()));
create policy pastoral_care_delete on public.pastoral_care_records for delete to authenticated
  using (public.owns_care_record(id));

create policy pastoral_care_access_select on public.pastoral_care_access for select to authenticated
  using (user_id = (select auth.uid()) or public.owns_care_record(record_id));
create policy pastoral_care_access_insert on public.pastoral_care_access for insert to authenticated
  with check (public.owns_care_record(record_id));
create policy pastoral_care_access_delete on public.pastoral_care_access for delete to authenticated
  using (public.owns_care_record(record_id));

-- Apprentices
create policy apprentices_select on public.apprentices for select to authenticated
  using (
    (select public.has_permission('discipleship.view'))
    or (select public.has_permission('groups.view'))
    or person_id = (select public.current_person_id())
    or (cell_group_id is not null and public.leads_group(cell_group_id))
  );
create policy apprentices_write on public.apprentices for all to authenticated
  using ((select public.has_permission('discipleship.manage')) or (select public.has_permission('groups.manage')))
  with check ((select public.has_permission('discipleship.manage')) or (select public.has_permission('groups.manage')));

-- Notifications: strictly personal. No insert policy: only definer functions write.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- Discipleship history
create policy discipleship_records_select on public.discipleship_records for select to authenticated
  using (
    (select public.has_permission('discipleship.view'))
    or person_id = (select public.current_person_id())
    or (
      (select public.has_permission('discipleship.view_assigned'))
      and (public.leads_person(person_id) or public.is_mentor_of(person_id))
    )
  );
create policy discipleship_records_update on public.discipleship_records for update to authenticated
  using ((select public.has_permission('discipleship.manage')))
  with check ((select public.has_permission('discipleship.manage')));

create policy discipleship_milestones_select on public.discipleship_milestones for select to authenticated
  using (
    (select public.has_permission('discipleship.view'))
    or person_id = (select public.current_person_id())
    or (
      (select public.has_permission('discipleship.view_assigned'))
      and (public.leads_person(person_id) or public.is_mentor_of(person_id))
    )
  );
create policy discipleship_milestones_write on public.discipleship_milestones for all to authenticated
  using (
    (select public.has_permission('discipleship.manage'))
    or (
      (select public.has_permission('discipleship.manage_assigned'))
      and (public.leads_person(person_id) or public.is_mentor_of(person_id))
    )
  )
  with check (
    (select public.has_permission('discipleship.manage'))
    or (
      (select public.has_permission('discipleship.manage_assigned'))
      and (public.leads_person(person_id) or public.is_mentor_of(person_id))
    )
  );

create policy mentor_relationships_select on public.mentor_relationships for select to authenticated
  using (
    (select public.has_permission('discipleship.view'))
    or disciple_id = (select public.current_person_id())
    or mentor_id = (select public.current_person_id())
    or ((select public.has_permission('discipleship.view_assigned')) and public.leads_person(disciple_id))
  );

-- Events
create policy events_select on public.events for select to authenticated
  using ((select public.has_permission('events.view')) or (select public.has_permission('events.manage')));
create policy events_insert on public.events for insert to authenticated
  with check ((select public.has_permission('events.manage')));
create policy events_update on public.events for update to authenticated
  using ((select public.has_permission('events.manage')))
  with check ((select public.has_permission('events.manage')));
create policy events_delete on public.events for delete to authenticated
  using ((select public.is_super_admin()));

-- Finance: nothing is readable without finance.view.
create policy giving_categories_select on public.giving_categories for select to authenticated
  using ((select public.has_permission('finance.view')) or (select public.has_permission('settings.manage')));
create policy giving_categories_write on public.giving_categories for all to authenticated
  using ((select public.has_permission('finance.manage')) or (select public.has_permission('settings.manage')))
  with check ((select public.has_permission('finance.manage')) or (select public.has_permission('settings.manage')));

create policy expense_categories_select on public.expense_categories for select to authenticated
  using ((select public.has_permission('finance.view')) or (select public.has_permission('settings.manage')));
create policy expense_categories_write on public.expense_categories for all to authenticated
  using ((select public.has_permission('finance.manage')) or (select public.has_permission('settings.manage')))
  with check ((select public.has_permission('finance.manage')) or (select public.has_permission('settings.manage')));

create policy giving_records_select on public.giving_records for select to authenticated
  using ((select public.has_permission('finance.view')));
create policy giving_records_write on public.giving_records for all to authenticated
  using ((select public.has_permission('finance.manage')))
  with check ((select public.has_permission('finance.manage')));

create policy expenses_select on public.expenses for select to authenticated
  using ((select public.has_permission('finance.view')));
create policy expenses_write on public.expenses for all to authenticated
  using ((select public.has_permission('finance.manage')))
  with check ((select public.has_permission('finance.manage')));

-- ---------------------------------------------------------------------------
-- Discipleship: one entry point for advancing a stage or assigning a mentor.
-- The history rows are written by the people trigger in 0010.
-- ---------------------------------------------------------------------------
create or replace function public.set_discipleship(
  target_person_id uuid,
  new_stage_id uuid,
  new_mentor_id uuid,
  stage_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    public.has_permission('discipleship.manage')
    or (
      public.has_permission('discipleship.manage_assigned')
      and (public.leads_person(target_person_id) or public.is_mentor_of(target_person_id))
    )
  ) then
    raise exception 'Not allowed to update this person''s discipleship' using errcode = '42501';
  end if;
  if new_mentor_id = target_person_id then
    raise exception 'A person cannot mentor themselves' using errcode = '23514';
  end if;

  update public.people
  set discipleship_stage_id = new_stage_id, mentor_id = new_mentor_id
  where id = target_person_id and archived_at is null;
  if not found then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;

  if nullif(btrim(stage_notes), '') is not null then
    update public.discipleship_records
    set notes = btrim(stage_notes)
    where person_id = target_person_id and completed_at is null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notification triggers
-- ---------------------------------------------------------------------------
create or replace function public.notify_follow_up_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null
     and new.status in ('pending', 'in_progress')
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and new.assigned_to is distinct from auth.uid() then
    perform public.notify_user(
      new.assigned_to, 'follow_up', 'A follow-up was assigned to you',
      (select full_name from public.people where id = new.person_id)
        || coalesce(' — due ' || to_char(new.due_date, 'Mon FMDD'), ''),
      '/care/follow-ups?focus=' || new.id, null
    );
  end if;
  return new;
end;
$$;

create trigger follow_ups_notify after insert or update of assigned_to on public.follow_ups
  for each row execute function public.notify_follow_up_assigned();

create or replace function public.notify_new_visitor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_permission(
    'care.manage', 'visitor', 'New visitor needs a follow-up',
    (select full_name from public.people where id = new.person_id),
    '/people/visitors/' || new.person_id, 'visitor:' || new.person_id
  );
  return new;
end;
$$;

create trigger visitor_profiles_notify after insert on public.visitor_profiles
  for each row execute function public.notify_new_visitor();

-- When a member reaches the absence threshold, open one absentee follow-up
-- (assigned to their cell leader when the leader has a login) and notify.
create or replace function public.check_absence_threshold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  threshold integer;
  streak integer;
  person public.people%rowtype;
  leader_user uuid;
  new_follow_up uuid;
begin
  select * into person from public.people where id = new.person_id;
  if person.person_type <> 'member' or person.archived_at is not null then
    return new;
  end if;

  select absence_threshold into threshold from public.church_settings limit 1;

  with recs as (
    select st.counts_as_present,
           row_number() over (order by s.session_date desc, s.created_at desc) as rn
    from public.attendance_records r
    join public.attendance_sessions s on s.id = r.session_id and s.archived_at is null
    join public.attendance_statuses st on st.id = r.status_id
    join public.attendance_types ty on ty.id = s.attendance_type_id and ty.counts_for_absence
    where r.person_id = new.person_id
  )
  select coalesce((select min(rn) - 1 from recs where counts_as_present), (select count(*) from recs))
  into streak;

  if streak < coalesce(threshold, 2) or exists (
    select 1 from public.follow_ups f
    where f.person_id = new.person_id
      and f.follow_up_type = 'absentee_follow_up'
      and f.status in ('pending', 'in_progress')
  ) then
    return new;
  end if;

  select leader.user_id into leader_user
  from public.cell_group_members m
  join public.cell_groups g on g.id = m.cell_group_id and g.archived_at is null
  join public.people leader on leader.id = g.leader_id
  where m.person_id = new.person_id and m.left_at is null;

  insert into public.follow_ups (person_id, follow_up_type, reason, assigned_to, priority, due_date, source)
  values (
    new.person_id, 'absentee_follow_up',
    'Absent from ' || streak || ' consecutive services',
    leader_user, 'high', public.church_today() + 3, 'absentee'
  )
  returning id into new_follow_up;

  perform public.notify_permission(
    'care.manage', 'absence', person.full_name || ' reached the absence threshold',
    streak || ' consecutive absences. A follow-up was created.',
    '/care/follow-ups?focus=' || new_follow_up, 'absence:' || new_follow_up
  );
  return new;
end;
$$;

create trigger attendance_records_absence after insert or update of status_id on public.attendance_records
  for each row execute function public.check_absence_threshold();

-- Time-based notifications have no scheduler to rely on, so they are produced
-- for the signed-in user whenever their notification list is loaded. Dedupe
-- keys make this safe to call any number of times.
create or replace function public.refresh_my_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  today date := public.church_today();
begin
  if me is null or not public.is_active_user() then
    return;
  end if;

  insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
  select me, 'follow_up',
         case when f.due_date < today then 'Follow-up overdue' else 'Follow-up due today' end,
         p.full_name || ' — ' || replace(f.follow_up_type, '_', ' '),
         '/care/follow-ups?focus=' || f.id,
         case when f.due_date < today then 'overdue:' || f.id else 'due:' || f.id || ':' || today end
  from public.follow_ups f
  join public.people p on p.id = f.person_id
  where f.assigned_to = me and f.status in ('pending', 'in_progress') and f.due_date <= today
  on conflict (user_id, dedupe_key) do nothing;

  insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
  select me, 'birthday', 'Birthday today', p.full_name, '/people/members/' || p.id,
         'birthday:' || p.id || ':' || extract(year from today)
  from public.people p
  where p.person_type = 'member' and p.archived_at is null and p.is_active
    and p.birthdate is not null
    and to_char(p.birthdate, 'MMDD') = to_char(today, 'MMDD')
    and (
      public.has_permission('members.view')
      or (public.has_permission('members.view_assigned') and public.leads_person(p.id))
    )
  on conflict (user_id, dedupe_key) do nothing;

  if public.has_permission('events.view') or public.has_permission('events.manage') then
    insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
    select me, 'event',
           case when e.event_date = today then 'Event today' else 'Event tomorrow' end,
           e.name || coalesce(' — ' || e.venue, ''), '/events/' || e.id,
           'event:' || e.id || ':' || e.event_date
    from public.events e
    where e.archived_at is null and e.status in ('upcoming', 'ongoing')
      and e.event_date between today and today + 1
    on conflict (user_id, dedupe_key) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Statistics (SECURITY INVOKER: filtered by the caller's RLS)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_extras()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'pending_follow_ups', (
      select count(*) from public.follow_ups where status in ('pending', 'in_progress')
    ),
    'overdue_follow_ups', (
      select count(*) from public.follow_ups
      where status in ('pending', 'in_progress') and due_date < public.church_today()
    ),
    'upcoming_events', (
      select count(*) from public.events
      where archived_at is null and status in ('upcoming', 'ongoing') and event_date >= public.church_today()
    )
  );
$$;

create or replace function public.cell_group_stats(target_group_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with sessions as (
    select s.id, s.session_date,
      (select count(*) from public.attendance_records r
         join public.attendance_statuses st on st.id = r.status_id
        where r.session_id = s.id and st.counts_as_present) as present,
      (select count(*) from public.attendance_records r
         join public.attendance_statuses st on st.id = r.status_id
        where r.session_id = s.id and not st.counts_as_present) as absent
    from public.attendance_sessions s
    where s.cell_group_id = target_group_id and s.archived_at is null
    order by s.session_date desc, s.created_at desc
    limit 12
  )
  select jsonb_build_object(
    'total_members', (
      select count(*) from public.cell_group_members where cell_group_id = target_group_id and left_at is null
    ),
    'new_members', (
      select count(*) from public.cell_group_members
      where cell_group_id = target_group_id and left_at is null
        and joined_at >= public.church_today() - 30
    ),
    'sessions', (select count(*) from sessions),
    'average_attendance', (select round(avg(present), 1) from sessions),
    'last_absentees', coalesce((select absent from sessions order by session_date desc limit 1), 0),
    'visitors', (
      select count(distinct r.person_id)
      from public.attendance_records r
      join public.attendance_sessions s on s.id = r.session_id
      join public.people p on p.id = r.person_id
      where s.cell_group_id = target_group_id and s.archived_at is null and p.person_type = 'visitor'
    ),
    'apprentices', (
      select count(*) from public.apprentices
      where cell_group_id = target_group_id and status in ('active', 'ready')
    ),
    'potential_leaders', (
      select count(*) from public.apprentices where cell_group_id = target_group_id and status = 'ready'
    )
  );
$$;

create or replace function public.finance_stats(from_date date default null, to_date date default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with t as (select public.church_today() as today),
  m as (
    select date_trunc('month', today)::date as cur, (date_trunc('month', today) + interval '1 month')::date as nxt
    from t
  ),
  months as (
    select generate_series(m.cur - interval '11 months', m.cur, interval '1 month')::date as month_start from m
  ),
  g as (
    select * from public.giving_records
    where (from_date is null or giving_date >= from_date) and (to_date is null or giving_date <= to_date)
  ),
  e as (
    select * from public.expenses
    where (from_date is null or expense_date >= from_date) and (to_date is null or expense_date <= to_date)
  )
  select jsonb_build_object(
    'total_giving', (select coalesce(sum(amount), 0) from g),
    'total_expenses', (select coalesce(sum(amount), 0) from e),
    'balance', (select coalesce(sum(amount), 0) from public.giving_records)
             - (select coalesce(sum(amount), 0) from public.expenses),
    'giving_this_month', (
      select coalesce(sum(amount), 0) from public.giving_records, m where giving_date >= m.cur and giving_date < m.nxt
    ),
    'expenses_this_month', (
      select coalesce(sum(amount), 0) from public.expenses, m where expense_date >= m.cur and expense_date < m.nxt
    ),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', month_start,
        'giving', (select coalesce(sum(amount), 0) from public.giving_records
                    where giving_date >= month_start and giving_date < month_start + interval '1 month'),
        'expenses', (select coalesce(sum(amount), 0) from public.expenses
                      where expense_date >= month_start and expense_date < month_start + interval '1 month')
      ) order by month_start)
      from months
    ), '[]'::jsonb),
    'giving_by_category', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'amount', x.amount) order by x.amount desc)
      from (select c.name, sum(g.amount) as amount from g join public.giving_categories c on c.id = g.category_id group by c.name) x
    ), '[]'::jsonb),
    'expenses_by_category', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'amount', x.amount) order by x.amount desc)
      from (select c.name, sum(e.amount) as amount from e join public.expense_categories c on c.id = e.category_id group by c.name) x
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Flat views for lists and reports (security_invoker: caller's RLS applies)
-- ---------------------------------------------------------------------------
create view public.follow_up_details with (security_invoker = true) as
select
  f.*,
  p.full_name as person_name,
  p.person_type,
  public.profile_name(f.assigned_to) as assigned_to_name,
  case
    when f.status in ('completed', 'cancelled') then 'closed'
    when f.due_date is null then 'no_date'
    when f.due_date < public.church_today() then 'overdue'
    when f.due_date = public.church_today() then 'today'
    else 'upcoming'
  end as due_state
from public.follow_ups f
left join public.people p on p.id = f.person_id;

create view public.pastoral_care_details with (security_invoker = true) as
select
  r.*,
  p.full_name as person_name,
  p.person_type,
  public.profile_name(r.assigned_to) as assigned_to_name
from public.pastoral_care_records r
left join public.people p on p.id = r.person_id;

create view public.giving_details with (security_invoker = true) as
select
  g.*,
  c.name as category_name,
  d.full_name as donor_name,
  public.profile_name(g.recorded_by) as recorded_by_name
from public.giving_records g
join public.giving_categories c on c.id = g.category_id
left join public.people d on d.id = g.donor_person_id;

create view public.expense_details with (security_invoker = true) as
select
  e.*,
  c.name as category_name,
  public.profile_name(e.recorded_by) as recorded_by_name
from public.expenses e
join public.expense_categories c on c.id = e.category_id;

create view public.cell_group_directory with (security_invoker = true) as
select
  g.*,
  leader.full_name as leader_name,
  assistant.full_name as assistant_leader_name,
  (select count(*) from public.cell_group_members m where m.cell_group_id = g.id and m.left_at is null) as member_count
from public.cell_groups g
left join public.people leader on leader.id = g.leader_id
left join public.people assistant on assistant.id = g.assistant_leader_id;

create view public.ministry_directory with (security_invoker = true) as
select
  m.*,
  leader.full_name as leader_name,
  assistant.full_name as assistant_leader_name,
  (select count(*) from public.ministry_members mm where mm.ministry_id = m.id and mm.status = 'active') as member_count
from public.ministries m
left join public.people leader on leader.id = m.leader_id
left join public.people assistant on assistant.id = m.assistant_leader_id;

create view public.ministry_member_details with (security_invoker = true) as
select
  mm.*,
  p.full_name as person_name,
  p.member_code,
  m.name as ministry_name
from public.ministry_members mm
join public.people p on p.id = mm.person_id
join public.ministries m on m.id = mm.ministry_id;

create view public.event_directory with (security_invoker = true) as
select
  e.*,
  s.id as session_id,
  (select count(*) from public.attendance_records r
     join public.attendance_statuses st on st.id = r.status_id
    where r.session_id = s.id and st.counts_as_present) as attendance_count
from public.events e
left join public.attendance_sessions s on s.event_id = e.id and s.archived_at is null;

-- ---------------------------------------------------------------------------
-- Seed: configurable finance categories
-- ---------------------------------------------------------------------------
insert into public.giving_categories (name, sort_order) values
  ('Tithes', 10), ('Offering', 20), ('Missions', 30),
  ('Building Fund', 40), ('Special Offering', 50), ('Other', 60)
on conflict (name) do nothing;

insert into public.expense_categories (name, sort_order) values
  ('Utilities', 10), ('Rent', 20), ('Ministry Supplies', 30), ('Honorarium', 40),
  ('Missions Support', 50), ('Maintenance', 60), ('Other', 70)
on conflict (name) do nothing;

-- Seeding is not user activity.
delete from public.activity_logs
where user_id is null and module = 'finance' and action = 'created'
  and created_at >= now() - interval '5 minutes';

-- ---------------------------------------------------------------------------
-- Grants for everything created since 0008
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, public;
revoke execute on all functions in schema public from anon, public;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

grant execute on function public.get_public_branding() to anon;

revoke insert, update, delete on public.activity_logs from authenticated;
revoke insert, delete on public.profiles from authenticated;
-- Users may only mark their notifications read or clear them.
revoke insert on public.notifications from authenticated;
-- History rows are written by triggers.
revoke insert, delete on public.discipleship_records from authenticated;
revoke insert, update, delete on public.mentor_relationships from authenticated;
-- The notify_* helpers must not be callable through the API.
revoke execute on function public.notify_user(uuid, text, text, text, text, text) from authenticated;
revoke execute on function public.notify_permission(text, text, text, text, text, text) from authenticated;
