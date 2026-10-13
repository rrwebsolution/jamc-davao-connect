-- JAMC Davao Connect — 0015 payment methods, financial accounts, transfers
--
-- Three separate facts about money received or spent:
--   category        what it was for        (Tithes, Utilities)        — existing
--   payment method  how it moved           (Cash, GCash, Check)       — new
--   account         where it sits          (Church Cash, JAMC GCash)  — new
-- A transfer between two accounts is its own table and is never income.

-- ---------------------------------------------------------------------------
-- Payment methods (configurable). `kind` is what the forms react to, so a
-- method can be renamed or added without touching code.
-- ---------------------------------------------------------------------------
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null default 'other' check (kind in ('cash', 'e_wallet', 'bank', 'check', 'other')),
  requires_reference boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payment_methods_set_updated_at before update on public.payment_methods
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Financial accounts
-- ---------------------------------------------------------------------------
create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  account_type text not null default 'cash' check (account_type in ('cash', 'e_wallet', 'bank', 'other')),
  -- GCash / Maya for e-wallets, the bank's name for bank accounts.
  provider text,
  account_holder text,
  account_number text,
  opening_balance numeric(14, 2) not null default 0,
  notes text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create trigger financial_accounts_set_updated_at before update on public.financial_accounts
  for each row execute function public.set_updated_at();
create trigger financial_accounts_set_audit_user before insert or update on public.financial_accounts
  for each row execute function public.set_audit_user();

-- ---------------------------------------------------------------------------
-- Transfers between accounts (internal: not giving, not an expense)
-- ---------------------------------------------------------------------------
create table public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  from_account_id uuid not null references public.financial_accounts (id) on delete restrict,
  to_account_id uuid not null references public.financial_accounts (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  transfer_date date not null,
  reference_number text,
  notes text,
  recorded_by uuid references public.profiles (id) on delete set null,
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);

create index account_transfers_from_idx on public.account_transfers (from_account_id, transfer_date);
create index account_transfers_to_idx on public.account_transfers (to_account_id, transfer_date);

create trigger account_transfers_recorded_by before insert or update on public.account_transfers
  for each row execute function public.set_recorded_by();
create trigger account_transfers_set_updated_at before update on public.account_transfers
  for each row execute function public.set_updated_at();
create trigger account_transfers_set_audit_user before insert or update on public.account_transfers
  for each row execute function public.set_audit_user();

-- ---------------------------------------------------------------------------
-- Giving and expenses: how and where
-- ---------------------------------------------------------------------------
alter table public.giving_records
  add column payment_method_id uuid references public.payment_methods (id) on delete restrict,
  add column financial_account_id uuid references public.financial_accounts (id) on delete restrict,
  add column check_number text,
  add column check_bank text,
  add column check_date date,
  -- Path of the receipt in the private payment-proofs bucket.
  add column proof_path text;

alter table public.expenses
  add column payment_method_id uuid references public.payment_methods (id) on delete restrict,
  add column financial_account_id uuid references public.financial_accounts (id) on delete restrict;

create index giving_records_method_idx on public.giving_records (payment_method_id);
create index giving_records_account_idx on public.giving_records (financial_account_id);
create index expenses_method_idx on public.expenses (payment_method_id);
create index expenses_account_idx on public.expenses (financial_account_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.payment_methods enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.account_transfers enable row level security;

create policy payment_methods_select on public.payment_methods for select to authenticated
  using ((select public.has_permission('finance.view')) or (select public.has_permission('settings.manage')));
create policy payment_methods_write on public.payment_methods for all to authenticated
  using ((select public.has_permission('finance.manage')) or (select public.has_permission('settings.manage')))
  with check ((select public.has_permission('finance.manage')) or (select public.has_permission('settings.manage')));

-- The table itself (with full account numbers) is for finance managers only.
-- Everyone else with finance.view reads the masked view below.
create policy financial_accounts_select on public.financial_accounts for select to authenticated
  using ((select public.has_permission('finance.manage')));
create policy financial_accounts_write on public.financial_accounts for all to authenticated
  using ((select public.has_permission('finance.manage')))
  with check ((select public.has_permission('finance.manage')));

create policy account_transfers_select on public.account_transfers for select to authenticated
  using ((select public.has_permission('finance.view')));
create policy account_transfers_write on public.account_transfers for all to authenticated
  using ((select public.has_permission('finance.manage')))
  with check ((select public.has_permission('finance.manage')));

-- ---------------------------------------------------------------------------
-- Masking. E-wallet: 0917 *** 1234. Anything else: **** **** 5678.
-- ---------------------------------------------------------------------------
create or replace function public.mask_account_number(account_number text, account_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when account_number is null or btrim(account_number) = '' then null
    when length(regexp_replace(account_number, '\D', '', 'g')) < 8 then '****'
    when account_type = 'e_wallet' then
      left(regexp_replace(account_number, '\D', '', 'g'), 4) || ' *** ' || right(regexp_replace(account_number, '\D', '', 'g'), 4)
    else '**** **** ' || right(regexp_replace(account_number, '\D', '', 'g'), 4)
  end;
$$;

-- What the app reads. Runs with the owner's rights on purpose (it has to see
-- past the manager-only table policy), so it carries its own permission check:
-- no finance.view, no rows; no finance.manage, no full account number.
create view public.financial_account_directory
with (security_invoker = false)
as
select
  a.id, a.name, a.account_type, a.provider, a.account_holder, a.notes,
  a.opening_balance, a.is_active, a.is_demo, a.sort_order, a.archived_at, a.created_at,
  public.mask_account_number(a.account_number, a.account_type) as account_number_masked,
  case when public.has_permission('finance.manage') then a.account_number end as account_number
from public.financial_accounts a
where public.has_permission('finance.view');

-- ---------------------------------------------------------------------------
-- Balances, always computed from the records
-- ---------------------------------------------------------------------------
create or replace function public.account_statement(from_date date default null, to_date date default null)
returns table (
  account_id uuid,
  account_name text,
  account_type text,
  is_active boolean,
  opening_balance numeric,
  giving_received numeric,
  expenses_paid numeric,
  transfers_in numeric,
  transfers_out numeric,
  closing_balance numeric
)
language sql
stable
set search_path = ''
as $$
  -- SECURITY INVOKER: reads through the caller's RLS, so it returns nothing
  -- without finance.view.
  with a as (
    select d.id, d.name, d.account_type, d.is_active, d.opening_balance, d.sort_order
    from public.financial_account_directory d
    where d.archived_at is null
  ),
  moves as (
    select financial_account_id as account_id, giving_date as on_date, amount, 'giving' as kind
    from public.giving_records where financial_account_id is not null
    union all
    select financial_account_id, expense_date, amount, 'expense'
    from public.expenses where financial_account_id is not null
    union all
    select to_account_id, transfer_date, amount, 'in' from public.account_transfers
    union all
    select from_account_id, transfer_date, amount, 'out' from public.account_transfers
  ),
  totals as (
    select
      a.id,
      -- Everything before the period rolls into its opening balance.
      coalesce(sum(case when from_date is not null and m.on_date < from_date
        then case when m.kind in ('giving', 'in') then m.amount else -m.amount end end), 0) as before_period,
      coalesce(sum(m.amount) filter (where m.kind = 'giving'
        and (from_date is null or m.on_date >= from_date) and (to_date is null or m.on_date <= to_date)), 0) as giving,
      coalesce(sum(m.amount) filter (where m.kind = 'expense'
        and (from_date is null or m.on_date >= from_date) and (to_date is null or m.on_date <= to_date)), 0) as expense,
      coalesce(sum(m.amount) filter (where m.kind = 'in'
        and (from_date is null or m.on_date >= from_date) and (to_date is null or m.on_date <= to_date)), 0) as t_in,
      coalesce(sum(m.amount) filter (where m.kind = 'out'
        and (from_date is null or m.on_date >= from_date) and (to_date is null or m.on_date <= to_date)), 0) as t_out
    from a
    left join moves m on m.account_id = a.id
    group by a.id
  )
  select
    a.id, a.name, a.account_type, a.is_active,
    a.opening_balance + t.before_period,
    t.giving, t.expense, t.t_in, t.t_out,
    a.opening_balance + t.before_period + t.giving - t.expense + t.t_in - t.t_out
  from a
  join totals t on t.id = a.id
  order by a.sort_order, a.name;
$$;

create or replace function public.giving_by_payment_method(from_date date default null, to_date date default null)
returns table (method_name text, kind text, amount numeric, records bigint)
language sql
stable
set search_path = ''
as $$
  select coalesce(pm.name, 'Not recorded'), coalesce(pm.kind, 'other'), sum(g.amount), count(*)
  from public.giving_records g
  left join public.payment_methods pm on pm.id = g.payment_method_id
  where (from_date is null or g.giving_date >= from_date) and (to_date is null or g.giving_date <= to_date)
  group by 1, 2
  order by 3 desc;
$$;

-- ---------------------------------------------------------------------------
-- Detail views: add method and account (rebuilt because the column list changed)
-- ---------------------------------------------------------------------------
drop view public.giving_details;
create view public.giving_details with (security_invoker = true) as
select
  g.*,
  c.name as category_name,
  d.full_name as donor_name,
  pm.name as payment_method_name,
  pm.kind as payment_method_kind,
  fa.name as account_name,
  public.profile_name(g.recorded_by) as recorded_by_name
from public.giving_records g
join public.giving_categories c on c.id = g.category_id
left join public.people d on d.id = g.donor_person_id
left join public.payment_methods pm on pm.id = g.payment_method_id
left join public.financial_account_directory fa on fa.id = g.financial_account_id;

drop view public.expense_details;
create view public.expense_details with (security_invoker = true) as
select
  e.*,
  c.name as category_name,
  pm.name as payment_method_name,
  fa.name as account_name,
  public.profile_name(e.recorded_by) as recorded_by_name
from public.expenses e
join public.expense_categories c on c.id = e.category_id
left join public.payment_methods pm on pm.id = e.payment_method_id
left join public.financial_account_directory fa on fa.id = e.financial_account_id;

create view public.account_transfer_details with (security_invoker = true) as
select
  t.*,
  f.name as from_account_name,
  o.name as to_account_name,
  public.profile_name(t.recorded_by) as recorded_by_name
from public.account_transfers t
left join public.financial_account_directory f on f.id = t.from_account_id
left join public.financial_account_directory o on o.id = t.to_account_id;

-- ---------------------------------------------------------------------------
-- Audit. Account logs name the account but never its number.
-- ---------------------------------------------------------------------------
create trigger payment_methods_audit after insert or update or delete on public.payment_methods
  for each row execute function public.audit_row('finance', 'Payment method', 'name');
create trigger financial_accounts_audit after insert or update or delete on public.financial_accounts
  for each row execute function public.audit_row('finance', 'Financial account', 'name');
create trigger account_transfers_audit after insert or update or delete on public.account_transfers
  for each row execute function public.audit_row('finance', 'Account transfer');

-- ---------------------------------------------------------------------------
-- Proof of payment: private bucket, signed links only
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy payment_proofs_select on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (select public.has_permission('finance.view')));
create policy payment_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (select public.has_permission('finance.manage')));
create policy payment_proofs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and (select public.has_permission('finance.manage')));

-- ---------------------------------------------------------------------------
-- Defaults (editable under Finance → Settings). No account numbers are seeded.
-- ---------------------------------------------------------------------------
insert into public.payment_methods (name, kind, requires_reference, sort_order) values
  ('Cash', 'cash', false, 10),
  ('GCash', 'e_wallet', true, 20),
  ('Maya', 'e_wallet', true, 30),
  ('Bank Transfer', 'bank', true, 40),
  ('Check', 'check', false, 50),
  ('Other', 'other', false, 60)
on conflict (name) do nothing;

insert into public.financial_accounts (name, account_type, sort_order) values ('Church Cash', 'cash', 10)
on conflict (name) do nothing;

delete from public.activity_logs
where user_id is null and module = 'finance' and action = 'created' and created_at >= now() - interval '5 minutes';

-- ---------------------------------------------------------------------------
-- Demo data removal now also covers demo accounts and transfers
-- ---------------------------------------------------------------------------
create or replace function public.remove_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  real_before bigint;
  real_after bigint;
  removed_people bigint;
  removed_other bigint := 0;
  n bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can remove demo data' using errcode = '42501';
  end if;

  select count(*) into real_before from public.people where not is_demo;

  delete from public.notifications nt
  where exists (select 1 from public.people p where p.is_demo and nt.link like '%' || p.id || '%')
     or exists (select 1 from public.events e where e.is_demo and nt.link like '%' || e.id || '%')
     or exists (select 1 from public.follow_ups f
                where (f.is_demo or f.person_id in (select id from public.people where is_demo))
                  and nt.link like '%' || f.id || '%');

  delete from public.attendance_records r
  where r.person_id in (select id from public.people where is_demo)
     or r.session_id in (select id from public.attendance_sessions where is_demo);
  get diagnostics n = row_count; removed_other := removed_other + n;

  delete from public.attendance_sessions where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.giving_records where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.expenses where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;

  -- Demo accounts: their transfers go, and any real record that was pointed
  -- at one is kept and simply loses the link.
  delete from public.account_transfers t
  where t.is_demo
     or t.from_account_id in (select id from public.financial_accounts where is_demo)
     or t.to_account_id in (select id from public.financial_accounts where is_demo);
  get diagnostics n = row_count; removed_other := removed_other + n;
  update public.giving_records set financial_account_id = null
  where financial_account_id in (select id from public.financial_accounts where is_demo);
  update public.expenses set financial_account_id = null
  where financial_account_id in (select id from public.financial_accounts where is_demo);
  delete from public.financial_accounts where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;

  delete from public.events where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.pastoral_care_records
  where is_demo or person_id in (select id from public.people where is_demo);
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.follow_ups
  where is_demo or person_id in (select id from public.people where is_demo);
  get diagnostics n = row_count; removed_other := removed_other + n;
  delete from public.apprentices
  where is_demo or person_id in (select id from public.people where is_demo);
  delete from public.discipleship_milestones
  where is_demo or person_id in (select id from public.people where is_demo);
  delete from public.cell_groups where is_demo;
  get diagnostics n = row_count; removed_other := removed_other + n;

  delete from public.people where is_demo;
  get diagnostics removed_people = row_count;

  select count(*) into real_after from public.people where not is_demo;
  if real_after <> real_before then
    raise exception 'Real records would have been affected; nothing was removed' using errcode = 'P0001';
  end if;

  delete from public.activity_logs
  where created_at = now() and user_id is not distinct from auth.uid() and action in ('deleted', 'updated');
  insert into public.activity_logs (user_id, action, module, description)
  values (auth.uid(), 'deleted', 'settings',
          'Demo data removed: ' || removed_people || ' people and ' || removed_other || ' related records');

  return jsonb_build_object('people', removed_people, 'other', removed_other);
end;
$$;

create or replace function public.demo_data_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_super_admin() then jsonb_build_object(
    'members', (select count(*) from public.people where is_demo and person_type = 'member'),
    'visitors', (select count(*) from public.people where is_demo and person_type = 'visitor'),
    'cell_groups', (select count(*) from public.cell_groups where is_demo),
    'attendance_sessions', (select count(*) from public.attendance_sessions where is_demo),
    'follow_ups', (select count(*) from public.follow_ups where is_demo),
    'care_records', (select count(*) from public.pastoral_care_records where is_demo),
    'events', (select count(*) from public.events where is_demo),
    'giving_records', (select count(*) from public.giving_records where is_demo),
    'expenses', (select count(*) from public.expenses where is_demo),
    'accounts', (select count(*) from public.financial_accounts where is_demo),
    'transfers', (select count(*) from public.account_transfers where is_demo)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- Grants for the new objects
-- ---------------------------------------------------------------------------
revoke all on public.payment_methods, public.financial_accounts, public.account_transfers,
  public.financial_account_directory, public.giving_details, public.expense_details,
  public.account_transfer_details from anon, public;
grant select, insert, update, delete on public.payment_methods, public.financial_accounts, public.account_transfers
  to authenticated;
grant select on public.financial_account_directory, public.giving_details, public.expense_details,
  public.account_transfer_details to authenticated;
grant all on public.payment_methods, public.financial_accounts, public.account_transfers,
  public.financial_account_directory, public.giving_details, public.expense_details,
  public.account_transfer_details to service_role;

revoke execute on function public.account_statement(date, date) from anon, public;
revoke execute on function public.giving_by_payment_method(date, date) from anon, public;
revoke execute on function public.mask_account_number(text, text) from anon, public;
grant execute on function public.account_statement(date, date) to authenticated, service_role;
grant execute on function public.giving_by_payment_method(date, date) to authenticated, service_role;
grant execute on function public.mask_account_number(text, text) to authenticated, service_role;
