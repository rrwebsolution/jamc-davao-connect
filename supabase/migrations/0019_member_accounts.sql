-- ============================================================================
-- JAMC Davao Connect — 0019 Members and user accounts, connected
--
-- A member is the person. A user account is that member's login. The link is
-- the existing people.user_id column, which is already UNIQUE: one member has
-- at most one account, and one account belongs to at most one member.
--
-- This migration adds no tables. It tightens the link, keeps the account's
-- display name and login email from drifting, and gives user managers one
-- place to read an account (with its member and last sign-in).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The link itself
-- ---------------------------------------------------------------------------
create or replace function public.guard_person_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A login can only be attached to a current member, not a visitor or an
  -- archived record.
  if new.user_id is not null and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    if new.person_type <> 'member' then
      raise exception 'Only a member can have a user account. Convert the visitor to a member first.'
        using errcode = '23514';
    end if;
    if new.archived_at is not null then
      raise exception 'An archived member cannot be given a user account' using errcode = '23514';
    end if;
  end if;

  -- Archiving a member must not leave a working login behind.
  if tg_op = 'UPDATE' and auth.uid() is not null
     and old.archived_at is null and new.archived_at is not null and new.user_id is not null
     and exists (select 1 from public.profiles p where p.id = new.user_id and p.is_active) then
    raise exception 'This member has an active system account. Disable the account when archiving.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger people_account_guard
  before insert or update on public.people
  for each row execute function public.guard_person_account();

-- The account shows the member's name: one source, the member record.
create or replace function public.sync_account_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    update public.profiles
    set full_name = new.full_name
    where id = new.user_id and full_name is distinct from new.full_name;
  end if;
  return null;
end;
$$;

create trigger people_sync_account_name
  after insert or update of first_name, last_name, user_id on public.people
  for each row execute function public.sync_account_name();

update public.profiles pr
set full_name = pe.full_name
from public.people pe
where pe.user_id = pr.id and pr.full_name is distinct from pe.full_name;

-- The login email lives in Supabase Auth. When it changes there (through the
-- Auth API, never by editing tables from the app), the account row follows.
-- A member's contact email is separate and is not touched.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Reading accounts: one row per login, with its member, roles and last sign-in.
-- Only for people who manage users.
-- ---------------------------------------------------------------------------
create or replace function public.account_directory()
returns table (
  user_id uuid,
  email text,
  display_name text,
  approval_status text,
  account_status text,
  is_active boolean,
  registration_source text,
  created_at timestamptz,
  approved_at timestamptz,
  approved_by_name text,
  last_sign_in_at timestamptz,
  person_id uuid,
  person_name text,
  member_code text,
  person_archived boolean,
  role_ids uuid[],
  role_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pr.id,
    pr.email,
    coalesce(pe.full_name, nullif(pr.full_name, ''), pr.email),
    pr.approval_status,
    pr.account_status,
    pr.is_active,
    pr.registration_source,
    pr.created_at,
    pr.approved_at,
    (select coalesce(nullif(a.full_name, ''), a.email) from public.profiles a where a.id = pr.approved_by),
    u.last_sign_in_at,
    pe.id,
    pe.full_name,
    pe.member_code,
    pe.archived_at is not null,
    coalesce((select array_agg(r.id order by r.name) from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = pr.id), '{}'),
    coalesce((select array_agg(r.name order by r.name) from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = pr.id), '{}')
  from public.profiles pr
  left join auth.users u on u.id = pr.id
  left join public.people pe on pe.user_id = pr.id
  where public.has_permission('users.manage');
$$;

-- ---------------------------------------------------------------------------
-- Linking an account to a member (new accounts, and older unlinked ones)
-- ---------------------------------------------------------------------------
create or replace function public.link_member_account(target_user_id uuid, target_person_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_name text;
  account_email text;
begin
  if not public.has_permission('users.manage') then
    raise exception 'Not allowed to manage user accounts' using errcode = '42501';
  end if;
  select email into account_email from public.profiles where id = target_user_id;
  if account_email is null then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.people where user_id = target_user_id) then
    raise exception 'That account is already linked to a member' using errcode = '23514';
  end if;

  update public.people
  set user_id = target_user_id
  where id = target_person_id and user_id is null and archived_at is null and person_type = 'member'
  returning full_name into linked_name;
  if linked_name is null then
    raise exception 'That member could not be linked (not found, archived, or already has a user account)'
      using errcode = '23514';
  end if;

  insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
  values (auth.uid(), 'linked', 'users', target_user_id::text, account_email,
          'Member linked to account: ' || linked_name || ' ↔ ' || account_email);
end;
$$;

-- ---------------------------------------------------------------------------
-- Archiving a member who has a working login: the account is disabled in the
-- same step. Nothing is deleted; history and the account row are kept.
-- ---------------------------------------------------------------------------
create or replace function public.archive_member_and_disable_account(target_person_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.people%rowtype;
begin
  if not (public.has_permission('members.archive') and public.has_permission('members.update')
          and public.has_permission('users.manage')) then
    raise exception 'Archiving a member with a system account needs permission to archive members and to manage users'
      using errcode = '42501';
  end if;
  select * into member from public.people where id = target_person_id and person_type = 'member' for update;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if member.user_id = auth.uid() then
    raise exception 'You cannot archive your own member record' using errcode = '42501';
  end if;

  if member.user_id is not null then
    if exists (
      select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
      where ur.user_id = member.user_id and r.key = 'super_admin'
    ) and not exists (
      select 1 from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      join public.profiles p on p.id = ur.user_id
      where r.key = 'super_admin' and p.is_active and ur.user_id <> member.user_id
    ) then
      raise exception 'This is the only active Super Admin. Give someone else that role first.' using errcode = '23514';
    end if;
    update public.profiles set account_status = 'disabled' where id = member.user_id and is_active;
    if found then
      insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
      values (auth.uid(), 'disabled', 'users', member.user_id::text, member.full_name,
              'Account disabled because the member was archived: ' || member.full_name);
    end if;
  end if;

  update public.people set archived_at = now() where id = target_person_id and archived_at is null;
  return member.user_id;
end;
$$;

-- A disabled or suspended account could still read its own member record
-- through the "this is me" rule. Access needs an active account everywhere.
drop policy people_select on public.people;
create policy people_select on public.people for select to authenticated
  using (
    (person_type = 'member' and (select public.has_permission('members.view')))
    or (person_type = 'visitor' and (select public.has_permission('visitors.view')))
    or (user_id = (select auth.uid()) and (select public.is_active_user()))
    or ((select public.has_permission('members.view_assigned')) and public.leads_person(id))
  );

revoke execute on function public.account_directory() from anon, public;
revoke execute on function public.link_member_account(uuid, uuid) from anon, public;
revoke execute on function public.archive_member_and_disable_account(uuid) from anon, public;
grant execute on function public.account_directory() to authenticated, service_role;
grant execute on function public.link_member_account(uuid, uuid) to authenticated, service_role;
grant execute on function public.archive_member_and_disable_account(uuid) to authenticated, service_role;
