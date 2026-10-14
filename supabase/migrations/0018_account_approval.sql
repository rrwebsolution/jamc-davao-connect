-- JAMC Davao Connect — 0018 self sign-up with admin approval
--
-- Three separate questions about an account:
--   email verified   does the address belong to this person?   (Supabase Auth)
--   approved         may this person use the church system?    (this migration)
--   role/permission  what may they do in it?                   (existing RBAC)
--
-- Every new account starts PENDING, whoever created it and whatever metadata
-- it carries. An admin creating a user approves it in the same server action;
-- a self sign-up waits on the Account Approvals page. Nothing a browser sends
-- at sign-up can make an account approved.
--
-- The link between a login and a member record is the existing people.user_id.

alter table public.profiles
  add column approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column account_status text not null default 'pending'
    check (account_status in ('pending', 'active', 'suspended', 'disabled')),
  add column registration_source text not null default 'self_signup'
    check (registration_source in ('self_signup', 'admin_created', 'invited')),
  add column first_name text,
  add column middle_name text,
  add column last_name text,
  add column mobile_number text,
  -- What the applicant said about already being a member. Admins do the matching.
  add column is_existing_member boolean not null default false,
  add column member_hint text,
  add column approved_at timestamptz,
  add column approved_by uuid references public.profiles (id) on delete set null,
  add column rejected_at timestamptz,
  add column rejected_by uuid references public.profiles (id) on delete set null,
  -- Internal note. Never shown to the applicant.
  add column rejection_reason text;

create index profiles_approval_idx on public.profiles (approval_status, created_at desc);

-- Everyone who already has an account was created by an administrator.
update public.profiles
set approval_status = 'approved',
    account_status = case when is_active then 'active' else 'suspended' end,
    registration_source = 'admin_created',
    approved_at = created_at;

-- ---------------------------------------------------------------------------
-- is_active stays the one flag every permission check reads. It is derived:
-- active only when the account is approved AND its status is 'active'.
-- ---------------------------------------------------------------------------
create or replace function public.sync_profile_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.is_active is distinct from old.is_active
     and new.account_status is not distinct from old.account_status then
    -- Older code paths flip is_active directly (suspend / reactivate).
    new.account_status := case when new.is_active then 'active' else 'suspended' end;
  end if;
  if new.approval_status <> 'approved' and new.account_status = 'active' then
    new.account_status := 'pending';
  end if;
  new.is_active := (new.approval_status = 'approved' and new.account_status = 'active');
  return new;
end;
$$;

create trigger profiles_sync_status
  before insert or update on public.profiles
  for each row execute function public.sync_profile_status();

-- New accounts: pending, with the applicant's details copied from sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  first_name text := nullif(btrim(left(meta ->> 'first_name', 80)), '');
  last_name text := nullif(btrim(left(meta ->> 'last_name', 80)), '');
begin
  insert into public.profiles (
    id, email, full_name, first_name, middle_name, last_name, mobile_number,
    is_existing_member, member_hint
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(btrim(left(meta ->> 'full_name', 160)), ''), btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
    first_name,
    nullif(btrim(left(meta ->> 'middle_name', 80)), ''),
    last_name,
    nullif(btrim(left(meta ->> 'mobile_number', 40)), ''),
    coalesce((meta ->> 'is_existing_member') = 'true', false),
    nullif(btrim(left(meta ->> 'member_hint', 500)), '')
  )
  on conflict (id) do nothing;

  -- Tell the people who can approve. (Admin-created accounts skip this: the
  -- admin is already there. Leaving the marker out only costs a notification;
  -- the account is pending either way.)
  if meta ->> 'signup' = 'self' then
    perform public.notify_permission(
      'users.manage', 'registration', 'New account registration',
      coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), new.email)
        || ' has requested access.',
      '/admin/approvals', 'registration:' || new.id
    );
  end if;
  return new;
end;
$$;

-- Only user managers may change approval, status or source. (The guard already
-- protects email and is_active the same way.)
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
  if (
    new.is_active is distinct from old.is_active
    or new.email is distinct from old.email
    or new.approval_status is distinct from old.approval_status
    or new.account_status is distinct from old.account_status
    or new.registration_source is distinct from old.registration_source
    or new.approved_at is distinct from old.approved_at
    or new.approved_by is distinct from old.approved_by
    or new.rejected_at is distinct from old.rejected_at
    or new.rejected_by is distinct from old.rejected_by
    or new.rejection_reason is distinct from old.rejection_reason
  ) and not public.has_permission('users.manage') then
    raise exception 'Not allowed to change account status or email'
      using errcode = '42501';
  end if;
  if (new.is_active is distinct from old.is_active or new.approval_status is distinct from old.approval_status)
     and new.id = auth.uid() then
    raise exception 'You cannot change the status of your own account'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Which roles the caller may hand out. A Super Admin: any role. Anyone else
-- with users.manage: any role except Super Admin, as long as it carries no
-- sensitive permission (administration, finance, confidential care) that they
-- do not hold themselves. So a user manager can make someone a Member, Cell
-- Leader or Pastor, but cannot hand out finance or admin access they lack.
-- ---------------------------------------------------------------------------
create or replace function public.can_assign_role(target_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin() or (
    public.has_permission('users.manage')
    and not exists (select 1 from public.roles r where r.id = target_role_id and r.key = 'super_admin')
    and not exists (
      select 1
      from public.role_permissions rp
      join public.permissions pm on pm.id = rp.permission_id
      where rp.role_id = target_role_id
        and (pm.module in ('Administration', 'Finance') or pm.key = 'care.confidential')
        and not public.has_permission(pm.key)
    )
  );
$$;

create or replace function public.assignable_roles()
returns table (id uuid, key text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.key, r.name
  from public.roles r
  where public.can_assign_role(r.id)
  order by case r.key when 'member' then 0 when 'cell_leader' then 1 when 'pastor' then 2 when 'super_admin' then 9 else 5 end, r.name;
$$;

-- The same rule for every role assignment, not just approvals.
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

  if tg_op = 'INSERT' and auth.uid() is not null and not public.can_assign_role(new.role_id) then
    raise exception 'You are not allowed to assign that role'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approve / reject
-- ---------------------------------------------------------------------------

-- member_action: 'none' | 'link' (to link_person_id) | 'create' (a new member record)
create or replace function public.approve_registration(
  target_user_id uuid,
  assign_role_id uuid,
  member_action text default 'none',
  link_person_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant public.profiles%rowtype;
  role_name text;
  linked_name text;
begin
  if not public.has_permission('users.manage') then
    raise exception 'Not allowed to approve accounts' using errcode = '42501';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'You cannot approve your own account' using errcode = '42501';
  end if;

  select * into applicant from public.profiles where id = target_user_id for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if applicant.approval_status = 'approved' then
    raise exception 'This account is already approved' using errcode = '23514';
  end if;

  select name into role_name from public.roles where id = assign_role_id;
  if role_name is null then
    raise exception 'Choose a role' using errcode = '23514';
  end if;
  if not public.can_assign_role(assign_role_id) then
    raise exception 'You are not allowed to assign the % role', role_name using errcode = '42501';
  end if;

  -- Link the login to a member record. Never matched automatically by name.
  if member_action = 'link' then
    update public.people
    set user_id = target_user_id
    where id = link_person_id and user_id is null and archived_at is null
    returning full_name into linked_name;
    if linked_name is null then
      raise exception 'That member could not be linked (not found, or already linked to a login)'
        using errcode = '23514';
    end if;
  elsif member_action = 'create' then
    if applicant.first_name is null or applicant.last_name is null then
      raise exception 'A first and last name are needed to create a member record' using errcode = '23514';
    end if;
    insert into public.people (person_type, first_name, middle_name, last_name, contact_number, email, user_id, membership_date)
    values ('member', applicant.first_name, applicant.middle_name, applicant.last_name,
            applicant.mobile_number, applicant.email, target_user_id, public.church_today())
    returning full_name into linked_name;
  end if;

  insert into public.user_roles (user_id, role_id) values (target_user_id, assign_role_id)
  on conflict do nothing;

  update public.profiles
  set approval_status = 'approved',
      account_status = 'active',
      approved_at = now(),
      approved_by = auth.uid(),
      rejected_at = null,
      rejected_by = null,
      rejection_reason = null
  where id = target_user_id;

  insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
  values (auth.uid(), 'approved', 'users', target_user_id::text, applicant.email,
          'Account approved: ' || applicant.email || ' as ' || role_name);
  if linked_name is not null then
    insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
    values (auth.uid(), 'linked', 'users', target_user_id::text, applicant.email,
            'Member linked to account: ' || linked_name || ' ↔ ' || applicant.email);
  end if;

  perform public.notify_user(
    target_user_id, 'account', 'Your account was approved',
    'You can now use the system as ' || role_name || '.', '/', 'approved:' || target_user_id
  );
  -- The request has been dealt with: clear it from the approvers' lists.
  delete from public.notifications where dedupe_key = 'registration:' || target_user_id;
end;
$$;

create or replace function public.reject_registration(target_user_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant_email text;
begin
  if not public.has_permission('users.manage') then
    raise exception 'Not allowed to reject accounts' using errcode = '42501';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'You cannot reject your own account' using errcode = '42501';
  end if;

  update public.profiles
  set approval_status = 'rejected',
      account_status = 'disabled',
      rejected_at = now(),
      rejected_by = auth.uid(),
      rejection_reason = nullif(btrim(reason), ''),
      approved_at = null,
      approved_by = null
  where id = target_user_id and approval_status <> 'approved'
  returning email into applicant_email;
  if applicant_email is null then
    raise exception 'Only an account that is not yet approved can be rejected' using errcode = '23514';
  end if;

  -- The reason stays in the profile; the log records only that it happened.
  insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
  values (auth.uid(), 'rejected', 'users', target_user_id::text, applicant_email,
          'Account rejected: ' || applicant_email);
  delete from public.notifications where dedupe_key = 'registration:' || target_user_id;
end;
$$;

-- Admin-created accounts: approved in the same action that creates them.
create or replace function public.mark_admin_created(target_user_id uuid, source text default 'admin_created')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('users.manage') then
    raise exception 'Not allowed to create accounts' using errcode = '42501';
  end if;
  update public.profiles
  set approval_status = 'approved',
      account_status = 'active',
      registration_source = case when source = 'invited' then 'invited' else 'admin_created' end,
      approved_at = now(),
      approved_by = auth.uid()
  where id = target_user_id;
end;
$$;

-- What the app needs to route a signed-in person: also for accounts that are
-- not active, so they can be shown the right status page.
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
        'theme_preference', p.theme_preference, 'is_active', p.is_active,
        'approval_status', p.approval_status, 'account_status', p.account_status
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

revoke execute on function public.approve_registration(uuid, uuid, text, uuid) from anon, public;
revoke execute on function public.reject_registration(uuid, text) from anon, public;
revoke execute on function public.mark_admin_created(uuid, text) from anon, public;
revoke execute on function public.can_assign_role(uuid) from anon, public;
revoke execute on function public.assignable_roles() from anon, public;
grant execute on function public.approve_registration(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.reject_registration(uuid, text) to authenticated, service_role;
grant execute on function public.mark_admin_created(uuid, text) to authenticated, service_role;
grant execute on function public.can_assign_role(uuid) to authenticated, service_role;
grant execute on function public.assignable_roles() to authenticated, service_role;

-- The backfill above is not user activity.
delete from public.activity_logs where user_id is null and module = 'users' and created_at = now();
