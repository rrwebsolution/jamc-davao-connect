-- JAMC Davao Connect — 0005 row level security
--
-- Every table has RLS enabled. The anon role gets no table access at all; the
-- login page reads branding through get_public_branding() only.
-- Constant permission checks are wrapped in (select ...) so Postgres evaluates
-- them once per statement instead of once per row.

-- ---------------------------------------------------------------------------
-- Helpers that read attendance without re-entering attendance RLS
-- ---------------------------------------------------------------------------
create or replace function public.session_group_id(target_session_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.cell_group_id from public.attendance_sessions s where s.id = target_session_id;
$$;

-- A session is visible to someone who can see at least one record in it:
-- their own, or (for cell leaders) one of the people they lead.
create or replace function public.has_visible_record_in_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attendance_records r
    where r.session_id = target_session_id
      and (
        r.person_id = public.current_person_id()
        or (public.has_permission('attendance.view_assigned') and public.leads_person(r.person_id))
      )
  );
$$;

-- Everything the app needs to know about the signed-in user, in one call.
create or replace function public.get_my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'email', p.email, 'full_name', p.full_name,
        'theme_preference', p.theme_preference, 'is_active', p.is_active
      )
      from public.profiles p where p.id = auth.uid()
    ),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name) order by r.name)
      from public.user_roles ur join public.roles r on r.id = ur.role_id
      where ur.user_id = auth.uid()
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(pm.key order by pm.key)
      from public.permissions pm
      where public.has_permission(pm.key)
    ), '[]'::jsonb),
    'person_id', public.current_person_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.church_settings enable row level security;
alter table public.system_appearance_settings enable row level security;
alter table public.membership_statuses enable row level security;
alter table public.baptism_statuses enable row level security;
alter table public.attendance_types enable row level security;
alter table public.attendance_statuses enable row level security;
alter table public.discipleship_stages enable row level security;
alter table public.people enable row level security;
alter table public.visitor_profiles enable row level security;
alter table public.cell_groups enable row level security;
alter table public.cell_group_members enable row level security;
alter table public.ministries enable row level security;
alter table public.ministry_members enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.activity_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Users, roles, permissions
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.has_permission('users.manage'))
    or (select public.has_permission('logs.view'))
  );

-- Column-level limits (email, is_active) are enforced by guard_profile_update.
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.has_permission('users.manage')))
  with check (id = (select auth.uid()) or (select public.has_permission('users.manage')));

create policy roles_select on public.roles for select to authenticated
  using ((select public.has_permission('users.manage')) or (select public.has_permission('roles.manage')));
create policy roles_insert on public.roles for insert to authenticated
  with check ((select public.has_permission('roles.manage')));
create policy roles_update on public.roles for update to authenticated
  using ((select public.has_permission('roles.manage')))
  with check ((select public.has_permission('roles.manage')));
create policy roles_delete on public.roles for delete to authenticated
  using ((select public.has_permission('roles.manage')));

create policy permissions_select on public.permissions for select to authenticated
  using ((select public.has_permission('users.manage')) or (select public.has_permission('roles.manage')));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using ((select public.has_permission('users.manage')) or (select public.has_permission('roles.manage')));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check ((select public.has_permission('roles.manage')));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using ((select public.has_permission('roles.manage')));

-- Granting or revoking Super Admin is further restricted by guard_user_roles.
create policy user_roles_select on public.user_roles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_permission('users.manage'))
    or (select public.has_permission('roles.manage'))
  );
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check ((select public.has_permission('users.manage')));
create policy user_roles_delete on public.user_roles for delete to authenticated
  using ((select public.has_permission('users.manage')));

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create policy church_settings_select on public.church_settings for select to authenticated
  using ((select public.is_active_user()));
create policy church_settings_update on public.church_settings for update to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

create policy appearance_select on public.system_appearance_settings for select to authenticated
  using ((select public.is_active_user()));
create policy appearance_update on public.system_appearance_settings for update to authenticated
  using ((select public.has_permission('appearance.manage')))
  with check ((select public.has_permission('appearance.manage')));

-- ---------------------------------------------------------------------------
-- Lookups: readable by any active user, managed through Settings
-- ---------------------------------------------------------------------------
create policy membership_statuses_select on public.membership_statuses for select to authenticated
  using ((select public.is_active_user()));
create policy membership_statuses_write on public.membership_statuses for all to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

create policy baptism_statuses_select on public.baptism_statuses for select to authenticated
  using ((select public.is_active_user()));
create policy baptism_statuses_write on public.baptism_statuses for all to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

create policy attendance_types_select on public.attendance_types for select to authenticated
  using ((select public.is_active_user()));
create policy attendance_types_write on public.attendance_types for all to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

create policy attendance_statuses_select on public.attendance_statuses for select to authenticated
  using ((select public.is_active_user()));
create policy attendance_statuses_write on public.attendance_statuses for all to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

create policy discipleship_stages_select on public.discipleship_stages for select to authenticated
  using ((select public.is_active_user()));
create policy discipleship_stages_write on public.discipleship_stages for all to authenticated
  using ((select public.has_permission('discipleship.manage')) or (select public.has_permission('settings.manage')))
  with check ((select public.has_permission('discipleship.manage')) or (select public.has_permission('settings.manage')));

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create policy people_select on public.people for select to authenticated
  using (
    (person_type = 'member' and (select public.has_permission('members.view')))
    or (person_type = 'visitor' and (select public.has_permission('visitors.view')))
    or user_id = (select auth.uid())
    or ((select public.has_permission('members.view_assigned')) and public.leads_person(id))
  );

create policy people_insert on public.people for insert to authenticated
  with check (
    (person_type = 'member' and (select public.has_permission('members.create')))
    or (person_type = 'visitor' and (select public.has_permission('visitors.create')))
  );

-- Archiving, type changes and login links are further restricted by guard_people.
create policy people_update on public.people for update to authenticated
  using (
    (person_type = 'member' and (select public.has_permission('members.update')))
    or (person_type = 'visitor' and (select public.has_permission('visitors.update')))
  )
  with check (
    (person_type = 'member' and (select public.has_permission('members.update')))
    or (person_type = 'visitor' and (select public.has_permission('visitors.update')))
  );

create policy people_delete on public.people for delete to authenticated
  using ((select public.is_super_admin()));

create policy visitor_profiles_select on public.visitor_profiles for select to authenticated
  using ((select public.has_permission('visitors.view')) or (select public.has_permission('members.view')));
create policy visitor_profiles_insert on public.visitor_profiles for insert to authenticated
  with check ((select public.has_permission('visitors.create')));
create policy visitor_profiles_update on public.visitor_profiles for update to authenticated
  using ((select public.has_permission('visitors.update')))
  with check ((select public.has_permission('visitors.update')));
create policy visitor_profiles_delete on public.visitor_profiles for delete to authenticated
  using ((select public.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Cell groups
-- ---------------------------------------------------------------------------
create policy cell_groups_select on public.cell_groups for select to authenticated
  using (
    (select public.has_permission('groups.view'))
    or (select public.has_permission('members.view'))
    or public.leads_group(id)
    or public.in_my_group(id)
  );
create policy cell_groups_insert on public.cell_groups for insert to authenticated
  with check ((select public.has_permission('groups.manage')));
create policy cell_groups_update on public.cell_groups for update to authenticated
  using ((select public.has_permission('groups.manage')))
  with check ((select public.has_permission('groups.manage')));
create policy cell_groups_delete on public.cell_groups for delete to authenticated
  using ((select public.is_super_admin()));

create policy cell_group_members_select on public.cell_group_members for select to authenticated
  using (
    (select public.has_permission('groups.view'))
    or (select public.has_permission('members.view'))
    or public.leads_group(cell_group_id)
    or person_id = (select public.current_person_id())
  );
create policy cell_group_members_insert on public.cell_group_members for insert to authenticated
  with check ((select public.has_permission('groups.manage')) or (select public.has_permission('members.update')));
create policy cell_group_members_update on public.cell_group_members for update to authenticated
  using ((select public.has_permission('groups.manage')) or (select public.has_permission('members.update')))
  with check ((select public.has_permission('groups.manage')) or (select public.has_permission('members.update')));
create policy cell_group_members_delete on public.cell_group_members for delete to authenticated
  using ((select public.has_permission('groups.manage')));

-- ---------------------------------------------------------------------------
-- Ministries
-- ---------------------------------------------------------------------------
create policy ministries_select on public.ministries for select to authenticated
  using ((select public.is_active_user()));
create policy ministries_insert on public.ministries for insert to authenticated
  with check ((select public.has_permission('ministries.manage')));
create policy ministries_update on public.ministries for update to authenticated
  using ((select public.has_permission('ministries.manage')))
  with check ((select public.has_permission('ministries.manage')));
create policy ministries_delete on public.ministries for delete to authenticated
  using ((select public.is_super_admin()));

create policy ministry_members_select on public.ministry_members for select to authenticated
  using (
    (select public.has_permission('ministries.view'))
    or (select public.has_permission('members.view'))
    or person_id = (select public.current_person_id())
    or ((select public.has_permission('members.view_assigned')) and public.leads_person(person_id))
  );
create policy ministry_members_insert on public.ministry_members for insert to authenticated
  with check ((select public.has_permission('ministries.manage')) or (select public.has_permission('members.update')));
create policy ministry_members_update on public.ministry_members for update to authenticated
  using ((select public.has_permission('ministries.manage')) or (select public.has_permission('members.update')))
  with check ((select public.has_permission('ministries.manage')) or (select public.has_permission('members.update')));
create policy ministry_members_delete on public.ministry_members for delete to authenticated
  using ((select public.has_permission('ministries.manage')) or (select public.has_permission('members.update')));

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
create policy attendance_sessions_select on public.attendance_sessions for select to authenticated
  using (
    (select public.has_permission('attendance.view'))
    or (
      (select public.has_permission('attendance.view_assigned'))
      and cell_group_id is not null and public.leads_group(cell_group_id)
    )
    or public.has_visible_record_in_session(id)
  );

create policy attendance_sessions_insert on public.attendance_sessions for insert to authenticated
  with check (
    (select public.has_permission('attendance.create'))
    or (
      (select public.has_permission('attendance.manage_assigned'))
      and cell_group_id is not null and public.leads_group(cell_group_id)
    )
  );

create policy attendance_sessions_update on public.attendance_sessions for update to authenticated
  using (
    (select public.has_permission('attendance.update'))
    or (
      (select public.has_permission('attendance.manage_assigned'))
      and cell_group_id is not null and public.leads_group(cell_group_id)
    )
  )
  with check (
    (select public.has_permission('attendance.update'))
    or (
      (select public.has_permission('attendance.manage_assigned'))
      and cell_group_id is not null and public.leads_group(cell_group_id)
    )
  );

create policy attendance_sessions_delete on public.attendance_sessions for delete to authenticated
  using ((select public.has_permission('attendance.update')));

create policy attendance_records_select on public.attendance_records for select to authenticated
  using (
    (select public.has_permission('attendance.view'))
    or person_id = (select public.current_person_id())
    or ((select public.has_permission('attendance.view_assigned')) and public.leads_person(person_id))
  );

create policy attendance_records_insert on public.attendance_records for insert to authenticated
  with check (
    (select public.has_permission('attendance.create'))
    or (
      (select public.has_permission('attendance.manage_assigned'))
      and public.leads_group(public.session_group_id(session_id))
      and public.leads_person(person_id)
    )
  );

create policy attendance_records_update on public.attendance_records for update to authenticated
  using (
    (select public.has_permission('attendance.update'))
    or (
      (select public.has_permission('attendance.manage_assigned'))
      and public.leads_group(public.session_group_id(session_id))
      and public.leads_person(person_id)
    )
  )
  with check (
    (select public.has_permission('attendance.update'))
    or (
      (select public.has_permission('attendance.manage_assigned'))
      and public.leads_group(public.session_group_id(session_id))
      and public.leads_person(person_id)
    )
  );

create policy attendance_records_delete on public.attendance_records for delete to authenticated
  using (
    (select public.has_permission('attendance.update'))
    or (
      (select public.has_permission('attendance.manage_assigned'))
      and public.leads_group(public.session_group_id(session_id))
      and public.leads_person(person_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Activity logs: read-only, and only with logs.view. No write policies exist,
-- so rows can only come from the audit triggers.
-- ---------------------------------------------------------------------------
create policy activity_logs_select on public.activity_logs for select to authenticated
  using ((select public.has_permission('logs.view')));
