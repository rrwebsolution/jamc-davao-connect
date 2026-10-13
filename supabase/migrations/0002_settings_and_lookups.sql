-- JAMC Davao Connect — 0002 settings and configurable lookups

-- ---------------------------------------------------------------------------
-- Church settings (single row)
-- ---------------------------------------------------------------------------
create table public.church_settings (
  id boolean primary key default true check (id),
  church_name text not null default 'JAMC-Davao',
  church_address text,
  contact_number text,
  email text,
  timezone text not null default 'Asia/Manila',
  date_format text not null default 'MMM d, yyyy'
    check (date_format in ('MMM d, yyyy', 'MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd')),
  member_id_prefix text not null default 'JAMC-' check (char_length(member_id_prefix) <= 12),
  member_id_padding integer not null default 5 check (member_id_padding between 3 and 10),
  absence_threshold integer not null default 2 check (absence_threshold between 1 and 52),
  track_individual_giving boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger church_settings_set_updated_at
  before update on public.church_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Branding + appearance (single row)
-- ---------------------------------------------------------------------------
create table public.system_appearance_settings (
  id boolean primary key default true check (id),
  system_name text not null default 'JAMC Davao Connect',
  system_short_name text not null default 'JAMC Connect',
  tagline text not null default 'People. Groups. Care. Growth.',
  logo_path text,
  login_logo_path text,
  favicon_path text,
  login_background_path text,
  primary_color text not null default '#7C2D12' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null default '#F3E7DA' check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#B45309' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  sidebar_background_color text not null default '#431407' check (sidebar_background_color ~ '^#[0-9A-Fa-f]{6}$'),
  sidebar_text_color text not null default '#FDF4E7' check (sidebar_text_color ~ '^#[0-9A-Fa-f]{6}$'),
  navbar_color text not null default '#FFFFFF' check (navbar_color ~ '^#[0-9A-Fa-f]{6}$'),
  background_color text not null default '#FBF7F2' check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  card_color text not null default '#FFFFFF' check (card_color ~ '^#[0-9A-Fa-f]{6}$'),
  button_color text not null default '#7C2D12' check (button_color ~ '^#[0-9A-Fa-f]{6}$'),
  button_text_color text not null default '#FFFFFF' check (button_text_color ~ '^#[0-9A-Fa-f]{6}$'),
  link_color text not null default '#9A3412' check (link_color ~ '^#[0-9A-Fa-f]{6}$'),
  default_theme text not null default 'light' check (default_theme in ('light', 'dark', 'system')),
  allow_user_theme_override boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger system_appearance_settings_set_updated_at
  before update on public.system_appearance_settings
  for each row execute function public.set_updated_at();

-- What the login page and root layout need before anyone is signed in.
-- Deliberately exposes only branding, never contact details or thresholds.
create or replace function public.get_public_branding()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(a) - 'id' - 'updated_by' - 'created_at'
         || jsonb_build_object('church_name', c.church_name)
  from public.system_appearance_settings a
  cross join public.church_settings c
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Configurable lookups
-- ---------------------------------------------------------------------------
create table public.membership_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.baptism_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.attendance_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- Sessions of these types count toward the consecutive-absence threshold.
  counts_for_absence boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.attendance_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  counts_as_present boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.discipleship_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger membership_statuses_set_updated_at before update on public.membership_statuses
  for each row execute function public.set_updated_at();
create trigger baptism_statuses_set_updated_at before update on public.baptism_statuses
  for each row execute function public.set_updated_at();
create trigger attendance_types_set_updated_at before update on public.attendance_types
  for each row execute function public.set_updated_at();
create trigger attendance_statuses_set_updated_at before update on public.attendance_statuses
  for each row execute function public.set_updated_at();
create trigger discipleship_stages_set_updated_at before update on public.discipleship_stages
  for each row execute function public.set_updated_at();
