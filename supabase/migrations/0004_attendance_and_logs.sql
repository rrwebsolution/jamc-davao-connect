-- JAMC Davao Connect — 0004 attendance and activity logs

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  attendance_type_id uuid not null references public.attendance_types (id) on delete restrict,
  title text not null check (char_length(btrim(title)) > 0),
  session_date date not null,
  -- Set for cell meetings so the group's leaders can record them.
  cell_group_id uuid references public.cell_groups (id) on delete set null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index attendance_sessions_date_idx on public.attendance_sessions (session_date desc);
create index attendance_sessions_type_idx on public.attendance_sessions (attendance_type_id);
create index attendance_sessions_group_idx on public.attendance_sessions (cell_group_id);

create trigger attendance_sessions_set_updated_at before update on public.attendance_sessions
  for each row execute function public.set_updated_at();
create trigger attendance_sessions_set_audit_user before insert or update on public.attendance_sessions
  for each row execute function public.set_audit_user();

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete restrict,
  status_id uuid not null references public.attendance_statuses (id) on delete restrict,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, person_id)
);

create index attendance_records_person_idx on public.attendance_records (person_id);
create index attendance_records_status_idx on public.attendance_records (status_id);

create trigger attendance_records_set_updated_at before update on public.attendance_records
  for each row execute function public.set_updated_at();
create trigger attendance_records_set_audit_user before insert or update on public.attendance_records
  for each row execute function public.set_audit_user();

-- ---------------------------------------------------------------------------
-- Activity logs: written only by triggers, so entries cannot be forged or
-- edited from the application.
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  module text not null,
  record_id text,
  record_label text,
  description text not null,
  created_at timestamptz not null default now()
);

create index activity_logs_created_idx on public.activity_logs (created_at desc);
create index activity_logs_module_idx on public.activity_logs (module, created_at desc);
create index activity_logs_user_idx on public.activity_logs (user_id, created_at desc);

-- Generic audit trigger.
--   TG_ARGV[0] = module name
--   TG_ARGV[1] = singular noun for the description ("Member")
--   TG_ARGV[2] = column holding a human-readable label (optional)
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  old_data jsonb;
  noun text := tg_argv[1];
  label text;
  verb text;
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
  else
    row_data := to_jsonb(new);
  end if;

  if tg_nargs > 2 then
    label := row_data ->> tg_argv[2];
  end if;

  if tg_op = 'INSERT' then
    verb := 'created';
  elsif tg_op = 'DELETE' then
    verb := 'deleted';
  else
    old_data := to_jsonb(old);
    -- Skip updates that only touched bookkeeping columns.
    if (row_data - 'updated_at' - 'updated_by') = (old_data - 'updated_at' - 'updated_by') then
      return new;
    end if;
    if row_data ? 'archived_at'
       and (row_data ->> 'archived_at') is distinct from (old_data ->> 'archived_at') then
      verb := case when row_data ->> 'archived_at' is null then 'restored' else 'archived' end;
    else
      verb := 'updated';
    end if;
  end if;

  insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
  values (
    auth.uid(),
    verb,
    tg_argv[0],
    coalesce(row_data ->> 'id', row_data ->> 'person_id'),
    label,
    noun || ' ' || verb || coalesce(': ' || label, '')
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger people_audit after insert or update or delete on public.people
  for each row execute function public.audit_row('people', 'Person', 'full_name');
create trigger cell_groups_audit after insert or update or delete on public.cell_groups
  for each row execute function public.audit_row('groups', 'Cell group', 'name');
create trigger ministries_audit after insert or update or delete on public.ministries
  for each row execute function public.audit_row('ministries', 'Ministry', 'name');
create trigger attendance_sessions_audit after insert or update or delete on public.attendance_sessions
  for each row execute function public.audit_row('attendance', 'Attendance session', 'title');
create trigger attendance_records_audit after update or delete on public.attendance_records
  for each row execute function public.audit_row('attendance', 'Attendance record');
create trigger roles_audit after insert or update or delete on public.roles
  for each row execute function public.audit_row('roles', 'Role', 'name');
create trigger profiles_audit after insert or update on public.profiles
  for each row execute function public.audit_row('users', 'User', 'email');
create trigger church_settings_audit after update on public.church_settings
  for each row execute function public.audit_row('settings', 'Church settings');
create trigger system_appearance_settings_audit after update on public.system_appearance_settings
  for each row execute function public.audit_row('appearance', 'Branding and theme');
create trigger membership_statuses_audit after insert or update or delete on public.membership_statuses
  for each row execute function public.audit_row('settings', 'Membership status', 'name');
create trigger baptism_statuses_audit after insert or update or delete on public.baptism_statuses
  for each row execute function public.audit_row('settings', 'Baptism status', 'name');
create trigger attendance_types_audit after insert or update or delete on public.attendance_types
  for each row execute function public.audit_row('settings', 'Attendance type', 'name');
create trigger attendance_statuses_audit after insert or update or delete on public.attendance_statuses
  for each row execute function public.audit_row('settings', 'Attendance status', 'name');
create trigger discipleship_stages_audit after insert or update or delete on public.discipleship_stages
  for each row execute function public.audit_row('discipleship', 'Discipleship stage', 'name');

-- Role and permission changes need the names of both sides, so they get their
-- own trigger functions.
create or replace function public.audit_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid := coalesce(new.user_id, old.user_id);
  target_email text;
  role_name text;
begin
  select email into target_email from public.profiles where id = target_user;
  select name into role_name from public.roles where id = coalesce(new.role_id, old.role_id);

  insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
  values (
    auth.uid(),
    case when tg_op = 'DELETE' then 'role_removed' else 'role_assigned' end,
    'users',
    target_user::text,
    target_email,
    case when tg_op = 'DELETE'
      then 'Role removed: ' || coalesce(role_name, '?') || ' from ' || coalesce(target_email, '?')
      else 'Role assigned: ' || coalesce(role_name, '?') || ' to ' || coalesce(target_email, '?')
    end
  );
  return coalesce(new, old);
end;
$$;

create trigger user_roles_audit after insert or delete on public.user_roles
  for each row execute function public.audit_user_role();

create or replace function public.audit_role_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  permission_key text;
begin
  select name into role_name from public.roles where id = coalesce(new.role_id, old.role_id);
  select key into permission_key from public.permissions
  where id = coalesce(new.permission_id, old.permission_id);

  -- The role itself is being deleted; the role's own log entry covers it.
  if role_name is null then
    return coalesce(new, old);
  end if;

  insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
  values (
    auth.uid(),
    case when tg_op = 'DELETE' then 'permission_revoked' else 'permission_granted' end,
    'roles',
    coalesce(new.role_id, old.role_id)::text,
    role_name,
    case when tg_op = 'DELETE'
      then 'Permission revoked: ' || coalesce(permission_key, '?') || ' from ' || role_name
      else 'Permission granted: ' || coalesce(permission_key, '?') || ' to ' || role_name
    end
  );
  return coalesce(new, old);
end;
$$;

create trigger role_permissions_audit after insert or delete on public.role_permissions
  for each row execute function public.audit_role_permission();
