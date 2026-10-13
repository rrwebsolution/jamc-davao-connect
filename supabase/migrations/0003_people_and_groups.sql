-- JAMC Davao Connect — 0003 people, visitors, cell groups, ministries
--
-- Members and visitors are the same `people` row with a different person_type.
-- Converting a visitor to a member flips the type in place, so attendance and
-- follow-up history stay attached and nobody is ever duplicated.

create sequence public.member_code_seq;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  person_type text not null default 'member' check (person_type in ('member', 'visitor')),
  member_code text unique,
  first_name text not null check (char_length(btrim(first_name)) > 0),
  middle_name text,
  last_name text not null check (char_length(btrim(last_name)) > 0),
  nickname text,
  full_name text generated always as (btrim(first_name) || ' ' || btrim(last_name)) stored,
  gender text check (gender in ('male', 'female')),
  birthdate date check (birthdate <= current_date),
  civil_status text check (civil_status in ('single', 'married', 'widowed', 'separated')),
  contact_number text,
  email text,
  address text,
  photo_path text,
  date_first_attended date,
  membership_date date,
  membership_status_id uuid references public.membership_statuses (id) on delete restrict,
  baptism_status_id uuid references public.baptism_statuses (id) on delete restrict,
  baptism_date date,
  discipleship_stage_id uuid references public.discipleship_stages (id) on delete restrict,
  mentor_id uuid references public.people (id) on delete set null,
  is_active boolean not null default true,
  -- Links a person to their login, for the member portal and for cell leaders.
  user_id uuid unique references public.profiles (id) on delete set null,
  converted_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (mentor_id is null or mentor_id <> id)
);

create index people_type_idx on public.people (person_type) where archived_at is null;
create index people_full_name_trgm_idx on public.people using gin (full_name gin_trgm_ops);
create index people_last_name_idx on public.people (last_name, first_name);
create index people_membership_status_idx on public.people (membership_status_id);
create index people_discipleship_stage_idx on public.people (discipleship_stage_id);
create index people_mentor_idx on public.people (mentor_id);
create index people_membership_date_idx on public.people (membership_date);
create index people_birth_month_day_idx
  on public.people ((extract(month from birthdate)), (extract(day from birthdate)));

create trigger people_set_updated_at before update on public.people
  for each row execute function public.set_updated_at();
create trigger people_set_audit_user before insert or update on public.people
  for each row execute function public.set_audit_user();

-- ---------------------------------------------------------------------------
-- Visitor details (kept after conversion as history)
-- ---------------------------------------------------------------------------
create table public.visitor_profiles (
  person_id uuid primary key references public.people (id) on delete cascade,
  first_visit_date date not null default current_date,
  invited_by_person_id uuid references public.people (id) on delete set null,
  invited_by_name text,
  attendance_type_id uuid references public.attendance_types (id) on delete set null,
  prayer_request text,
  notes text,
  status text not null default 'new' check (
    status in ('new', 'contacted', 'follow_up_scheduled', 'returning',
               'connected_to_cell_group', 'became_member')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index visitor_profiles_first_visit_idx on public.visitor_profiles (first_visit_date);
create index visitor_profiles_status_idx on public.visitor_profiles (status);
create index visitor_profiles_invited_by_idx on public.visitor_profiles (invited_by_person_id);

create trigger visitor_profiles_set_updated_at before update on public.visitor_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Cell groups
-- ---------------------------------------------------------------------------
create table public.cell_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  leader_id uuid references public.people (id) on delete set null,
  assistant_leader_id uuid references public.people (id) on delete set null,
  meeting_day text check (
    meeting_day in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  ),
  meeting_time time,
  location text,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index cell_groups_leader_idx on public.cell_groups (leader_id);
create index cell_groups_assistant_leader_idx on public.cell_groups (assistant_leader_id);

create trigger cell_groups_set_updated_at before update on public.cell_groups
  for each row execute function public.set_updated_at();
create trigger cell_groups_set_audit_user before insert or update on public.cell_groups
  for each row execute function public.set_audit_user();

create table public.cell_group_members (
  id uuid primary key default gen_random_uuid(),
  cell_group_id uuid not null references public.cell_groups (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  joined_at date not null default current_date,
  left_at date,
  created_at timestamptz not null default now(),
  check (left_at is null or left_at >= joined_at)
);

-- A person belongs to at most one cell group at a time; past rows are history.
create unique index cell_group_members_one_active_idx
  on public.cell_group_members (person_id) where left_at is null;
create index cell_group_members_group_idx on public.cell_group_members (cell_group_id);

-- ---------------------------------------------------------------------------
-- Ministries
-- ---------------------------------------------------------------------------
create table public.ministries (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  leader_id uuid references public.people (id) on delete set null,
  assistant_leader_id uuid references public.people (id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create trigger ministries_set_updated_at before update on public.ministries
  for each row execute function public.set_updated_at();

create table public.ministry_members (
  id uuid primary key default gen_random_uuid(),
  ministry_id uuid not null references public.ministries (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  role text,
  date_assigned date not null default current_date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ministry_id, person_id)
);

create index ministry_members_person_idx on public.ministry_members (person_id);

create trigger ministry_members_set_updated_at before update on public.ministry_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Scope helpers used by RLS
-- ---------------------------------------------------------------------------
create or replace function public.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.people p where p.user_id = auth.uid() limit 1;
$$;

create or replace function public.leads_group(group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cell_groups g
    where g.id = group_id
      and g.archived_at is null
      and public.current_person_id() in (g.leader_id, g.assistant_leader_id)
  );
$$;

create or replace function public.leads_person(target_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cell_group_members m
    join public.cell_groups g on g.id = m.cell_group_id
    where m.person_id = target_person_id
      and m.left_at is null
      and g.archived_at is null
      and public.current_person_id() in (g.leader_id, g.assistant_leader_id)
  );
$$;

create or replace function public.in_my_group(group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cell_group_members m
    where m.cell_group_id = group_id
      and m.left_at is null
      and m.person_id = public.current_person_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- People guards: member IDs and the column-level rules RLS cannot express
-- ---------------------------------------------------------------------------
create or replace function public.guard_people()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings record;
begin
  if tg_op = 'UPDATE' and auth.uid() is not null then
    if new.person_type is distinct from old.person_type then
      if not (old.person_type = 'visitor' and new.person_type = 'member') then
        raise exception 'A member cannot be changed back into a visitor' using errcode = '23514';
      end if;
      if not public.has_permission('members.create') then
        raise exception 'Not allowed to convert visitors to members' using errcode = '42501';
      end if;
    end if;

    if new.archived_at is distinct from old.archived_at
       and old.person_type = 'member'
       and not public.has_permission('members.archive') then
      raise exception 'Not allowed to archive or restore members' using errcode = '42501';
    end if;

    if new.user_id is distinct from old.user_id and not public.has_permission('users.manage') then
      raise exception 'Not allowed to link a person to a login' using errcode = '42501';
    end if;

    if old.member_code is not null and new.member_code is distinct from old.member_code
       and not public.is_super_admin() then
      raise exception 'Member IDs cannot be changed' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' and auth.uid() is not null
     and new.user_id is not null and not public.has_permission('users.manage') then
    raise exception 'Not allowed to link a person to a login' using errcode = '42501';
  end if;

  if new.person_type = 'member' and new.member_code is null then
    select member_id_prefix, member_id_padding into settings
    from public.church_settings limit 1;
    new.member_code := coalesce(settings.member_id_prefix, 'JAMC-')
      || lpad(nextval('public.member_code_seq')::text, coalesce(settings.member_id_padding, 5), '0');
  end if;

  return new;
end;
$$;

create trigger people_guard
  before insert or update on public.people
  for each row execute function public.guard_people();

-- ---------------------------------------------------------------------------
-- Convert a visitor into a member, in place
-- ---------------------------------------------------------------------------
create or replace function public.convert_visitor_to_member(
  target_person_id uuid,
  new_membership_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  person public.people%rowtype;
  visit_date date;
begin
  if not (public.has_permission('visitors.update') and public.has_permission('members.create')) then
    raise exception 'Not allowed to convert visitors to members' using errcode = '42501';
  end if;

  select * into person from public.people where id = target_person_id for update;
  if not found then
    raise exception 'Visitor not found' using errcode = 'P0002';
  end if;
  if person.person_type <> 'visitor' then
    raise exception 'This person is already a member' using errcode = '23514';
  end if;

  select first_visit_date into visit_date
  from public.visitor_profiles where person_id = target_person_id;

  update public.people
  set person_type = 'member',
      membership_date = coalesce(new_membership_date, current_date),
      date_first_attended = coalesce(date_first_attended, visit_date),
      membership_status_id = coalesce(
        membership_status_id,
        (select id from public.membership_statuses where is_default and is_active
         order by sort_order limit 1)
      ),
      converted_at = now(),
      archived_at = null,
      is_active = true
  where id = target_person_id;

  update public.visitor_profiles
  set status = 'became_member'
  where person_id = target_person_id;

  return target_person_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Member portal: a person may update only their own contact details
-- ---------------------------------------------------------------------------
create or replace function public.update_my_person(
  new_nickname text,
  new_contact_number text,
  new_email text,
  new_address text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_id uuid;
begin
  update public.people
  set nickname = nullif(btrim(new_nickname), ''),
      contact_number = nullif(btrim(new_contact_number), ''),
      email = nullif(btrim(new_email), ''),
      address = nullif(btrim(new_address), '')
  where user_id = auth.uid() and archived_at is null
  returning id into my_id;

  if my_id is null then
    raise exception 'No member record is linked to your account' using errcode = 'P0002';
  end if;
  return my_id;
end;
$$;
