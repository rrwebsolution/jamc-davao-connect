-- JAMC Davao Connect — 0001 foundation
-- Profiles, roles, permissions and the helper functions every RLS policy uses.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at / updated_by current
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_audit_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  theme_preference text check (theme_preference in ('light', 'dark', 'system')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create the profile automatically when an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Roles & permissions
-- ---------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module text not null,
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create index role_permissions_permission_idx on public.role_permissions (permission_id);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index user_roles_role_idx on public.user_roles (role_id);

-- ---------------------------------------------------------------------------
-- Permission helpers (SECURITY DEFINER so policies can call them without
-- recursing into the RLS of the tables they read)
-- ---------------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and r.key = 'super_admin'
      and p.is_active
  );
$$;

create or replace function public.has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin() or exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions pm on pm.id = rp.permission_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and pm.key = permission_key
      and p.is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- Guards that RLS alone cannot express
-- ---------------------------------------------------------------------------

-- Users may edit their own name/theme, but only user managers may change
-- email or the active flag.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- service role / migrations
  end if;
  if (new.is_active is distinct from old.is_active or new.email is distinct from old.email)
     and not public.has_permission('users.manage') then
    raise exception 'Not allowed to change account status or email'
      using errcode = '42501';
  end if;
  if new.is_active is distinct from old.is_active and new.id = auth.uid() then
    raise exception 'You cannot deactivate your own account'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Only a Super Admin may grant or revoke the Super Admin role, and the last
-- Super Admin can never be removed.
create or replace function public.guard_user_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role_key text;
  remaining integer;
begin
  select r.key into target_role_key
  from public.roles r
  where r.id = coalesce(new.role_id, old.role_id);

  if target_role_key = 'super_admin' then
    if auth.uid() is not null and not public.is_super_admin() then
      raise exception 'Only a Super Admin can change Super Admin access'
        using errcode = '42501';
    end if;

    if tg_op in ('DELETE', 'UPDATE') then
      select count(*) into remaining
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where r.key = 'super_admin'
        and not (ur.user_id = old.user_id and ur.role_id = old.role_id);
      if remaining = 0 then
        raise exception 'The system must keep at least one Super Admin'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  return new;
end;
$$;

create trigger user_roles_guard
  before insert or update or delete on public.user_roles
  for each row execute function public.guard_user_roles();

-- System roles cannot be deleted or re-keyed.
create or replace function public.guard_system_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'System roles cannot be deleted' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.is_system and (new.key is distinct from old.key or new.is_system is distinct from old.is_system) then
    raise exception 'System roles cannot be re-keyed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger roles_guard_system
  before update or delete on public.roles
  for each row execute function public.guard_system_roles();
