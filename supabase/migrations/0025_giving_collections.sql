-- ============================================================================
-- JAMC Davao Connect — 0025 Giving collections (batch entry)
--
-- A collection is one sitting of giving (a Sunday service, an event) entered
-- together instead of one record at a time.
--
--   giving_collections          the header: name, date, mode, status
--   giving_collection_entries   its lines, as they were typed in
--
-- NO DOUBLE COUNTING. The header carries no amount of its own. While a
-- collection is a DRAFT its lines are only lines: nothing reaches
-- giving_records, so drafts never appear in totals, reports or balances.
-- POSTING copies each line into giving_records (linked by collection_id);
-- from then on every existing report, account balance and statement counts
-- it exactly once, through the same table as single giving entries.
-- VOIDING removes those giving_records again and keeps the collection and its
-- lines as the audit trail.
--
-- All writes go through the functions below, which check finance.manage.
-- ============================================================================

create table public.giving_collections (
  id uuid primary key default gen_random_uuid(),
  collection_name text not null check (char_length(btrim(collection_name)) between 1 and 160),
  collection_date date not null,
  -- "Service / Event": a kind of service, or a specific event. Both optional.
  attendance_type_id uuid references public.attendance_types (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  entry_mode text not null default 'summary' check (entry_mode in ('summary', 'detailed')),
  status text not null default 'draft' check (status in ('draft', 'posted', 'voided')),
  notes text check (char_length(notes) <= 1000),
  -- Optional reconciliation sheet / deposit slip, in the private payment-proofs bucket.
  attachment_path text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  posted_by uuid references public.profiles (id) on delete set null,
  posted_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index giving_collections_date_idx on public.giving_collections (collection_date desc, created_at desc);
create index giving_collections_status_idx on public.giving_collections (status);

create trigger giving_collections_set_updated_at before update on public.giving_collections
  for each row execute function public.set_updated_at();

create table public.giving_collection_entries (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.giving_collections (id) on delete cascade,
  position integer not null default 0,
  category_id uuid not null references public.giving_categories (id) on delete restrict,
  payment_method_id uuid not null references public.payment_methods (id) on delete restrict,
  financial_account_id uuid references public.financial_accounts (id) on delete set null,
  -- Null = anonymous / unidentified.
  donor_person_id uuid references public.people (id) on delete set null,
  amount numeric(14, 2) not null check (amount > 0),
  reference_number text check (char_length(reference_number) <= 120),
  notes text check (char_length(notes) <= 500),
  -- The giving record this line became when the collection was posted.
  giving_record_id uuid references public.giving_records (id) on delete set null
);

create index giving_collection_entries_collection_idx on public.giving_collection_entries (collection_id, position);

alter table public.giving_records
  add column collection_id uuid references public.giving_collections (id) on delete restrict;

create index giving_records_collection_idx on public.giving_records (collection_id) where collection_id is not null;

-- ---------------------------------------------------------------------------
-- Records that came from a collection are changed through the collection
-- (void it), never one by one, or the collection and the ledger would
-- disagree. The functions below set a transaction-local flag to pass.
-- ---------------------------------------------------------------------------
create or replace function public.guard_collection_records()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or current_setting('app.collection_write', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.collection_id is not null then
      raise exception 'Entries are added to a collection by posting it' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.collection_id is not null then
    if tg_op = 'DELETE' then
      raise exception 'This entry belongs to a posted collection. Void the collection to remove it.' using errcode = '23514';
    end if;
    if new.collection_id is distinct from old.collection_id
       or new.amount is distinct from old.amount
       or new.giving_date is distinct from old.giving_date
       or new.category_id is distinct from old.category_id
       or new.payment_method_id is distinct from old.payment_method_id
       or new.donor_person_id is distinct from old.donor_person_id
       or new.reference_number is distinct from old.reference_number
       or (new.financial_account_id is distinct from old.financial_account_id and new.financial_account_id is not null) then
      raise exception 'This entry belongs to a posted collection. Void the collection to change it.' using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' and new.collection_id is not null then
    raise exception 'Entries are added to a collection by posting it' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger giving_records_collection_guard
  before insert or update or delete on public.giving_records
  for each row execute function public.guard_collection_records();

-- ---------------------------------------------------------------------------
-- Save a draft: the header and all of its lines, in one transaction.
--   header:  { collection_name, collection_date, attendance_type_id, event_id,
--              entry_mode, notes, attachment_path }
--   entries: [ { category_id, payment_method_id, financial_account_id,
--                donor_person_id, amount, reference_number, notes }, ... ]
-- ---------------------------------------------------------------------------
create or replace function public.save_giving_collection(target_id uuid, header jsonb, entries jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := target_id;
  current_status text;
  name text := btrim(coalesce(header ->> 'collection_name', ''));
  mode text := coalesce(header ->> 'entry_mode', 'summary');
  line jsonb;
  line_position integer := 0;
begin
  if not public.has_permission('finance.manage') then
    raise exception 'Not allowed to record giving' using errcode = '42501';
  end if;
  if name = '' then
    raise exception 'Give the collection a name' using errcode = '23514';
  end if;
  if nullif(header ->> 'collection_date', '') is null then
    raise exception 'Choose the collection date' using errcode = '23514';
  end if;
  if mode not in ('summary', 'detailed') then
    raise exception 'Unknown entry mode' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(entries, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(entries, '[]'::jsonb)) > 500 then
    raise exception 'A collection can hold up to 500 entries' using errcode = '23514';
  end if;

  if cid is null then
    insert into public.giving_collections (
      collection_name, collection_date, attendance_type_id, event_id, entry_mode, notes, attachment_path, created_by, updated_by
    )
    values (
      name, (header ->> 'collection_date')::date,
      nullif(header ->> 'attendance_type_id', '')::uuid, nullif(header ->> 'event_id', '')::uuid,
      mode, nullif(btrim(header ->> 'notes'), ''), nullif(header ->> 'attachment_path', ''), auth.uid(), auth.uid()
    )
    returning id into cid;
    insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
    values (auth.uid(), 'created', 'finance', cid::text, name, 'Giving collection created: ' || name);
  else
    select status into current_status from public.giving_collections where id = cid for update;
    if current_status is null then
      raise exception 'Collection not found' using errcode = 'P0002';
    end if;
    if current_status <> 'draft' then
      raise exception 'Only a draft collection can be edited' using errcode = '23514';
    end if;
    update public.giving_collections
    set collection_name = name,
        collection_date = (header ->> 'collection_date')::date,
        attendance_type_id = nullif(header ->> 'attendance_type_id', '')::uuid,
        event_id = nullif(header ->> 'event_id', '')::uuid,
        entry_mode = mode,
        notes = nullif(btrim(header ->> 'notes'), ''),
        attachment_path = nullif(header ->> 'attachment_path', ''),
        updated_by = auth.uid()
    where id = cid;
    delete from public.giving_collection_entries e where e.collection_id = cid;
    insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
    values (auth.uid(), 'updated', 'finance', cid::text, name, 'Giving collection updated: ' || name);
  end if;

  for line in select * from jsonb_array_elements(coalesce(entries, '[]'::jsonb)) loop
    if nullif(line ->> 'category_id', '') is null or nullif(line ->> 'payment_method_id', '') is null then
      raise exception 'Every entry needs a category and a payment method' using errcode = '23514';
    end if;
    insert into public.giving_collection_entries (
      collection_id, position, category_id, payment_method_id, financial_account_id, donor_person_id, amount, reference_number, notes
    )
    values (
      cid, line_position,
      (line ->> 'category_id')::uuid, (line ->> 'payment_method_id')::uuid,
      nullif(line ->> 'financial_account_id', '')::uuid, nullif(line ->> 'donor_person_id', '')::uuid,
      (line ->> 'amount')::numeric, nullif(btrim(line ->> 'reference_number'), ''), nullif(btrim(line ->> 'notes'), '')
    );
    line_position := line_position + 1;
  end loop;

  return cid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Post: each line becomes one giving record. This is the only moment the
-- money enters the ledger.
-- ---------------------------------------------------------------------------
create or replace function public.post_giving_collection(target_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  collection public.giving_collections%rowtype;
  line record;
  record_id uuid;
  posted integer := 0;
begin
  if not public.has_permission('finance.manage') then
    raise exception 'Not allowed to post collections' using errcode = '42501';
  end if;
  select * into collection from public.giving_collections where id = target_id for update;
  if not found then
    raise exception 'Collection not found' using errcode = 'P0002';
  end if;
  if collection.status <> 'draft' then
    raise exception 'This collection has already been %', collection.status using errcode = '23514';
  end if;
  if not exists (select 1 from public.giving_collection_entries where collection_id = target_id) then
    raise exception 'Add at least one entry before posting' using errcode = '23514';
  end if;

  perform set_config('app.collection_write', 'on', true);
  for line in
    select * from public.giving_collection_entries where collection_id = target_id order by position
  loop
    insert into public.giving_records (
      giving_date, category_id, amount, reference_number, notes, donor_person_id,
      payment_method_id, financial_account_id, collection_id
    )
    values (
      collection.collection_date, line.category_id, line.amount, line.reference_number, line.notes, line.donor_person_id,
      line.payment_method_id, line.financial_account_id, target_id
    )
    returning id into record_id;
    update public.giving_collection_entries set giving_record_id = record_id where id = line.id;
    posted := posted + 1;
  end loop;
  perform set_config('app.collection_write', 'off', true);

  update public.giving_collections
  set status = 'posted', posted_by = auth.uid(), posted_at = now(), updated_by = auth.uid()
  where id = target_id;

  -- Amounts stay out of the activity log, as for every other finance entry.
  insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
  values (auth.uid(), 'posted', 'finance', target_id::text, collection.collection_name,
          'Giving collection posted: ' || collection.collection_name || ' (' || posted || ' entries)');
  return posted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Void: take the money back out of the ledger, keep the collection and its
-- lines as history.
-- ---------------------------------------------------------------------------
create or replace function public.void_giving_collection(target_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  collection public.giving_collections%rowtype;
begin
  if not public.has_permission('finance.manage') then
    raise exception 'Not allowed to void collections' using errcode = '42501';
  end if;
  select * into collection from public.giving_collections where id = target_id for update;
  if not found then
    raise exception 'Collection not found' using errcode = 'P0002';
  end if;
  if collection.status <> 'posted' then
    raise exception 'Only a posted collection can be voided' using errcode = '23514';
  end if;

  perform set_config('app.collection_write', 'on', true);
  delete from public.giving_records where collection_id = target_id;
  perform set_config('app.collection_write', 'off', true);

  update public.giving_collections
  set status = 'voided', voided_by = auth.uid(), voided_at = now(),
      void_reason = nullif(btrim(left(reason, 500)), ''), updated_by = auth.uid()
  where id = target_id;

  insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
  values (auth.uid(), 'voided', 'finance', target_id::text, collection.collection_name,
          'Giving collection voided: ' || collection.collection_name);
end;
$$;

-- A draft that is no longer wanted. Posted collections are voided, never deleted.
create or replace function public.discard_giving_collection(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  discarded text;
begin
  if not public.has_permission('finance.manage') then
    raise exception 'Not allowed to discard collections' using errcode = '42501';
  end if;
  delete from public.giving_collections where id = target_id and status = 'draft' returning collection_name into discarded;
  if discarded is null then
    raise exception 'Only a draft collection can be discarded' using errcode = '23514';
  end if;
  insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
  values (auth.uid(), 'deleted', 'finance', target_id::text, discarded, 'Draft giving collection discarded: ' || discarded);
end;
$$;

-- ---------------------------------------------------------------------------
-- Duplicate check: which of these reference numbers are already in the ledger?
-- Runs as the caller, so it only ever sees what finance.view allows.
-- ---------------------------------------------------------------------------
create or replace function public.existing_giving_references(refs text[], exclude_collection uuid default null)
returns table (reference_number text, giving_date date, payment_method_name text, collection_name text)
language sql
stable
set search_path = ''
as $$
  select g.reference_number, g.giving_date, pm.name, c.collection_name
  from public.giving_records g
  left join public.payment_methods pm on pm.id = g.payment_method_id
  left join public.giving_collections c on c.id = g.collection_id
  where g.reference_number is not null
    and lower(btrim(g.reference_number)) in (select lower(btrim(r)) from unnest(refs) r where btrim(r) <> '')
    and (exclude_collection is null or g.collection_id is distinct from exclude_collection)
  order by g.giving_date desc
  limit 50;
$$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
alter table public.giving_collections enable row level security;
alter table public.giving_collection_entries enable row level security;

create policy giving_collections_select on public.giving_collections for select to authenticated
  using ((select public.has_permission('finance.view')));
create policy giving_collection_entries_select on public.giving_collection_entries for select to authenticated
  using ((select public.has_permission('finance.view')));

-- The header with its totals, worked out from the lines (never stored twice).
create view public.giving_collection_summary with (security_invoker = true) as
select
  c.*,
  t.name as attendance_type_name,
  e.name as event_name,
  public.profile_name(c.created_by) as created_by_name,
  public.profile_name(c.posted_by) as posted_by_name,
  public.profile_name(c.voided_by) as voided_by_name,
  coalesce(s.entry_count, 0)::integer as entry_count,
  coalesce(s.total, 0) as total
from public.giving_collections c
left join public.attendance_types t on t.id = c.attendance_type_id
left join public.events e on e.id = c.event_id
left join lateral (
  select count(*) as entry_count, sum(amount) as total
  from public.giving_collection_entries x where x.collection_id = c.id
) s on true;

create view public.giving_collection_entry_details with (security_invoker = true) as
select
  x.*,
  c.name as category_name,
  pm.name as payment_method_name,
  pm.kind as payment_method_kind,
  fa.name as account_name,
  d.full_name as donor_name
from public.giving_collection_entries x
join public.giving_categories c on c.id = x.category_id
join public.payment_methods pm on pm.id = x.payment_method_id
left join public.financial_account_directory fa on fa.id = x.financial_account_id
left join public.people d on d.id = x.donor_person_id;

-- Giving list: say which collection an entry came from (rebuilt because the column list changed).
drop view public.giving_details;
create view public.giving_details with (security_invoker = true) as
select
  g.*,
  c.name as category_name,
  d.full_name as donor_name,
  pm.name as payment_method_name,
  pm.kind as payment_method_kind,
  fa.name as account_name,
  public.profile_name(g.recorded_by) as recorded_by_name,
  gc.collection_name
from public.giving_records g
join public.giving_categories c on c.id = g.category_id
left join public.people d on d.id = g.donor_person_id
left join public.payment_methods pm on pm.id = g.payment_method_id
left join public.financial_account_directory fa on fa.id = g.financial_account_id
left join public.giving_collections gc on gc.id = g.collection_id;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on public.giving_collections, public.giving_collection_entries, public.giving_collection_summary,
  public.giving_collection_entry_details, public.giving_details from anon, public;
grant select on public.giving_collections, public.giving_collection_entries, public.giving_collection_summary,
  public.giving_collection_entry_details, public.giving_details to authenticated;
grant all on public.giving_collections, public.giving_collection_entries, public.giving_collection_summary,
  public.giving_collection_entry_details, public.giving_details to service_role;

revoke execute on function public.save_giving_collection(uuid, jsonb, jsonb) from anon, public;
revoke execute on function public.post_giving_collection(uuid) from anon, public;
revoke execute on function public.void_giving_collection(uuid, text) from anon, public;
revoke execute on function public.discard_giving_collection(uuid) from anon, public;
revoke execute on function public.existing_giving_references(text[], uuid) from anon, public;
grant execute on function public.save_giving_collection(uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.post_giving_collection(uuid) to authenticated, service_role;
grant execute on function public.void_giving_collection(uuid, text) to authenticated, service_role;
grant execute on function public.discard_giving_collection(uuid) to authenticated, service_role;
grant execute on function public.existing_giving_references(text[], uuid) to authenticated, service_role;
