-- JAMC Davao Connect — 0010 tables for Phases 2-4
-- Follow-ups, pastoral care, notifications, apprentices, discipleship history,
-- events and finance. Existing tables (cell_groups, cell_group_members,
-- ministries, ministry_members, discipleship_stages, attendance_*) are reused:
-- group attendance and event attendance are attendance_sessions rows.

-- ---------------------------------------------------------------------------
-- Staff directory helpers. Profiles are private under RLS, but screens need
-- to show "assigned to" / "recorded by" names and offer an assignee picker.
-- These expose id + display name of active users only.
-- ---------------------------------------------------------------------------
create or replace function public.profile_name(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_active_user()
    then (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = target_user_id)
  end;
$$;

create or replace function public.assignable_users()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(nullif(p.full_name, ''), p.email)
  from public.profiles p
  where p.is_active and public.is_active_user()
  order by 2;
$$;

create or replace function public.is_mentor_of(target_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.people p
    where p.id = target_person_id and p.mentor_id = public.current_person_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- Follow-ups
-- ---------------------------------------------------------------------------
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  follow_up_type text not null default 'call' check (
    follow_up_type in ('call', 'message', 'home_visit', 'prayer', 'encouragement',
                       'pastoral_conversation', 'visitor_follow_up', 'absentee_follow_up', 'other')
  ),
  reason text,
  assigned_to uuid references public.profiles (id) on delete set null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  notes text,
  completed_at timestamptz,
  -- 'absentee' rows are created by the attendance trigger.
  source text not null default 'manual' check (source in ('manual', 'absentee')),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index follow_ups_person_idx on public.follow_ups (person_id);
create index follow_ups_assigned_idx on public.follow_ups (assigned_to, status);
create index follow_ups_status_due_idx on public.follow_ups (status, due_date);

create or replace function public.follow_ups_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger follow_ups_before_write before insert or update on public.follow_ups
  for each row execute function public.follow_ups_before_write();
create trigger follow_ups_set_updated_at before update on public.follow_ups
  for each row execute function public.set_updated_at();
create trigger follow_ups_set_audit_user before insert or update on public.follow_ups
  for each row execute function public.set_audit_user();

-- Someone assigned a follow-up must be able to see who it is about.
create or replace function public.has_follow_up_for(target_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.follow_ups f
    where f.person_id = target_person_id and f.assigned_to = auth.uid()
      and f.status in ('pending', 'in_progress')
  );
$$;

-- ---------------------------------------------------------------------------
-- Pastoral care (sensitive; see the policies in 0011)
-- ---------------------------------------------------------------------------
create table public.pastoral_care_records (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  care_type text not null default 'counseling' check (
    care_type in ('counseling', 'prayer', 'hospital_visit', 'home_visit', 'bereavement',
                  'marriage_family', 'spiritual_guidance', 'encouragement', 'other')
  ),
  care_date date not null default current_date,
  assigned_to uuid references public.profiles (id) on delete set null,
  summary text not null check (char_length(btrim(summary)) > 0),
  notes text,
  follow_up_required boolean not null default false,
  follow_up_date date,
  confidentiality text not null default 'care_team'
    check (confidentiality in ('pastor_only', 'selected_leaders', 'care_team')),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pastoral_care_person_idx on public.pastoral_care_records (person_id, care_date desc);
create index pastoral_care_assigned_idx on public.pastoral_care_records (assigned_to);

create trigger pastoral_care_set_updated_at before update on public.pastoral_care_records
  for each row execute function public.set_updated_at();
create trigger pastoral_care_set_audit_user before insert or update on public.pastoral_care_records
  for each row execute function public.set_audit_user();

-- Who a "Selected Leaders" record is shared with.
create table public.pastoral_care_access (
  record_id uuid not null references public.pastoral_care_records (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (record_id, user_id)
);

create index pastoral_care_access_user_idx on public.pastoral_care_access (user_id);

-- ---------------------------------------------------------------------------
-- Apprentices (potential cell leaders, ministry leaders, mentors)
-- ---------------------------------------------------------------------------
create table public.apprentices (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  track text not null default 'cell_leader' check (track in ('cell_leader', 'ministry_leader', 'mentor')),
  cell_group_id uuid references public.cell_groups (id) on delete set null,
  ministry_id uuid references public.ministries (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'ready', 'graduated', 'paused')),
  started_at date not null default current_date,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, track)
);

create index apprentices_group_idx on public.apprentices (cell_group_id);

create trigger apprentices_set_updated_at before update on public.apprentices
  for each row execute function public.set_updated_at();
create trigger apprentices_set_audit_user before insert or update on public.apprentices
  for each row execute function public.set_audit_user();

-- ---------------------------------------------------------------------------
-- Notifications (written only by SECURITY DEFINER functions and triggers)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  -- Makes generated notifications idempotent: one per user per key.
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create or replace function public.notify_user(
  target_user_id uuid, kind text, title text, body text, link text, dedupe_key text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
  select target_user_id, kind, title, body, link, dedupe_key
  where target_user_id is not null
    and exists (select 1 from public.profiles p where p.id = target_user_id and p.is_active)
  on conflict (user_id, dedupe_key) do nothing;
$$;

-- Notify every active user holding a permission (Super Admins included).
create or replace function public.notify_permission(
  permission_key text, kind text, title text, body text, link text, dedupe_key text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
  select distinct p.id, kind, title, body, link, dedupe_key
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join public.roles r on r.id = ur.role_id
  left join public.role_permissions rp on rp.role_id = r.id
  left join public.permissions pm on pm.id = rp.permission_id
  where p.is_active and (r.key = 'super_admin' or pm.key = permission_key)
  on conflict (user_id, dedupe_key) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Discipleship history. people.discipleship_stage_id / mentor_id stay the
-- "current" values; these tables keep every stage and mentor a person has had.
-- ---------------------------------------------------------------------------
create table public.discipleship_records (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  stage_id uuid not null references public.discipleship_stages (id) on delete restrict,
  mentor_id uuid references public.people (id) on delete set null,
  started_at date not null default current_date,
  completed_at date,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_at is null or completed_at >= started_at)
);

-- At most one open (current) stage per person.
create unique index discipleship_records_one_open_idx
  on public.discipleship_records (person_id) where completed_at is null;
create index discipleship_records_person_idx on public.discipleship_records (person_id, started_at);
create index discipleship_records_stage_idx on public.discipleship_records (stage_id);

create trigger discipleship_records_set_updated_at before update on public.discipleship_records
  for each row execute function public.set_updated_at();
create trigger discipleship_records_set_audit_user before insert or update on public.discipleship_records
  for each row execute function public.set_audit_user();

create table public.discipleship_milestones (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  achieved_on date not null default current_date,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index discipleship_milestones_person_idx on public.discipleship_milestones (person_id, achieved_on);

create trigger discipleship_milestones_set_updated_at before update on public.discipleship_milestones
  for each row execute function public.set_updated_at();
create trigger discipleship_milestones_set_audit_user before insert or update on public.discipleship_milestones
  for each row execute function public.set_audit_user();

create table public.mentor_relationships (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.people (id) on delete cascade,
  disciple_id uuid not null references public.people (id) on delete cascade,
  started_at date not null default current_date,
  ended_at date,
  notes text,
  created_at timestamptz not null default now(),
  check (mentor_id <> disciple_id)
);

create unique index mentor_relationships_one_active_idx
  on public.mentor_relationships (disciple_id) where ended_at is null;
create index mentor_relationships_mentor_idx on public.mentor_relationships (mentor_id);

-- Keep the history in step with people.discipleship_stage_id / mentor_id, no
-- matter which screen changed them. The previous stage is closed, never deleted.
create or replace function public.sync_discipleship_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := public.church_today();
  open_record public.discipleship_records%rowtype;
  had_open boolean;
begin
  if tg_op = 'INSERT' or new.discipleship_stage_id is distinct from old.discipleship_stage_id then
    select * into open_record from public.discipleship_records
    where person_id = new.id and completed_at is null;
    had_open := found; -- FOUND is overwritten by the statements below

    if had_open and open_record.stage_id is distinct from new.discipleship_stage_id then
      update public.discipleship_records
      set completed_at = greatest(today, started_at)
      where id = open_record.id;
    end if;

    if new.discipleship_stage_id is not null
       and (not had_open or open_record.stage_id is distinct from new.discipleship_stage_id) then
      insert into public.discipleship_records (person_id, stage_id, mentor_id, started_at)
      values (new.id, new.discipleship_stage_id, new.mentor_id, today);

      if tg_op = 'UPDATE' then
        perform public.notify_user(
          (select m.user_id from public.people m where m.id = new.mentor_id),
          'discipleship', 'Discipleship milestone',
          new.full_name || ' moved to ' ||
            (select name from public.discipleship_stages where id = new.discipleship_stage_id),
          '/discipleship/' || new.id, null
        );
        perform public.notify_user(
          new.user_id, 'discipleship', 'You reached a new discipleship stage',
          (select name from public.discipleship_stages where id = new.discipleship_stage_id),
          '/profile', null
        );
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' or new.mentor_id is distinct from old.mentor_id then
    update public.mentor_relationships
    set ended_at = greatest(today, started_at)
    where disciple_id = new.id and ended_at is null and mentor_id is distinct from new.mentor_id;

    if new.mentor_id is not null and not exists (
      select 1 from public.mentor_relationships
      where disciple_id = new.id and ended_at is null
    ) then
      insert into public.mentor_relationships (mentor_id, disciple_id, started_at)
      values (new.mentor_id, new.id, today);
    end if;

    update public.discipleship_records
    set mentor_id = new.mentor_id
    where person_id = new.id and completed_at is null;
  end if;

  return new;
end;
$$;

create trigger people_sync_discipleship
  after insert or update of discipleship_stage_id, mentor_id on public.people
  for each row execute function public.sync_discipleship_history();

-- Backfill history for people who already have a stage or mentor.
insert into public.discipleship_records (person_id, stage_id, mentor_id, started_at)
select p.id, p.discipleship_stage_id, p.mentor_id, coalesce(p.membership_date, p.created_at::date)
from public.people p
where p.discipleship_stage_id is not null
  and not exists (select 1 from public.discipleship_records r where r.person_id = p.id);

insert into public.mentor_relationships (mentor_id, disciple_id, started_at)
select p.mentor_id, p.id, coalesce(p.membership_date, p.created_at::date)
from public.people p
where p.mentor_id is not null
  and not exists (select 1 from public.mentor_relationships r where r.disciple_id = p.id);

-- ---------------------------------------------------------------------------
-- Events. Attendance for an event is an attendance_sessions row linked to it.
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) > 0),
  description text,
  event_type text not null default 'church_event' check (
    event_type in ('sunday_service', 'prayer_meeting', 'cell_meeting', 'church_event',
                   'outreach', 'training', 'fellowship', 'other')
  ),
  event_date date not null,
  start_time time,
  end_time time,
  venue text,
  organizer text,
  status text not null default 'upcoming' check (status in ('upcoming', 'ongoing', 'completed', 'cancelled')),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index events_date_idx on public.events (event_date);
create index events_status_idx on public.events (status, event_date);

create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create trigger events_set_audit_user before insert or update on public.events
  for each row execute function public.set_audit_user();

alter table public.attendance_sessions
  add column event_id uuid references public.events (id) on delete set null;
create unique index attendance_sessions_event_idx
  on public.attendance_sessions (event_id) where event_id is not null;

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
create table public.giving_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger giving_categories_set_updated_at before update on public.giving_categories
  for each row execute function public.set_updated_at();
create trigger expense_categories_set_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();

create table public.giving_records (
  id uuid primary key default gen_random_uuid(),
  giving_date date not null,
  category_id uuid not null references public.giving_categories (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  reference_number text,
  notes text,
  -- Only used when church_settings.track_individual_giving is on.
  donor_person_id uuid references public.people (id) on delete set null,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index giving_records_date_idx on public.giving_records (giving_date desc);
create index giving_records_category_idx on public.giving_records (category_id);
create index giving_records_donor_idx on public.giving_records (donor_person_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category_id uuid not null references public.expense_categories (id) on delete restrict,
  description text not null check (char_length(btrim(description)) > 0),
  amount numeric(14, 2) not null check (amount > 0),
  payee text,
  reference_number text,
  notes text,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expenses_date_idx on public.expenses (expense_date desc);
create index expenses_category_idx on public.expenses (category_id);

create or replace function public.set_recorded_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  else
    new.recorded_by := old.recorded_by;
  end if;
  return new;
end;
$$;

create trigger giving_records_recorded_by before insert or update on public.giving_records
  for each row execute function public.set_recorded_by();
create trigger giving_records_set_updated_at before update on public.giving_records
  for each row execute function public.set_updated_at();
create trigger giving_records_set_audit_user before insert or update on public.giving_records
  for each row execute function public.set_audit_user();
create trigger expenses_recorded_by before insert or update on public.expenses
  for each row execute function public.set_recorded_by();
create trigger expenses_set_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
create trigger expenses_set_audit_user before insert or update on public.expenses
  for each row execute function public.set_audit_user();

-- ---------------------------------------------------------------------------
-- Audit triggers for the new tables. Pastoral care logs carry no label, so
-- the activity log never repeats anything from a confidential record.
-- ---------------------------------------------------------------------------
create trigger follow_ups_audit after insert or update or delete on public.follow_ups
  for each row execute function public.audit_row('care', 'Follow-up');
create trigger pastoral_care_audit after insert or update or delete on public.pastoral_care_records
  for each row execute function public.audit_row('care', 'Pastoral care record');
create trigger apprentices_audit after insert or update or delete on public.apprentices
  for each row execute function public.audit_row('discipleship', 'Apprentice');
create trigger discipleship_milestones_audit after insert or update or delete on public.discipleship_milestones
  for each row execute function public.audit_row('discipleship', 'Milestone', 'title');
create trigger events_audit after insert or update or delete on public.events
  for each row execute function public.audit_row('events', 'Event', 'name');
create trigger giving_records_audit after insert or update or delete on public.giving_records
  for each row execute function public.audit_row('finance', 'Giving record');
create trigger expenses_audit after insert or update or delete on public.expenses
  for each row execute function public.audit_row('finance', 'Expense record');
create trigger giving_categories_audit after insert or update or delete on public.giving_categories
  for each row execute function public.audit_row('finance', 'Giving category', 'name');
create trigger expense_categories_audit after insert or update or delete on public.expense_categories
  for each row execute function public.audit_row('finance', 'Expense category', 'name');
create trigger ministry_members_audit after insert or update or delete on public.ministry_members
  for each row execute function public.audit_row('ministries', 'Ministry assignment');
create trigger cell_group_members_audit after insert or update or delete on public.cell_group_members
  for each row execute function public.audit_row('groups', 'Cell group membership');
