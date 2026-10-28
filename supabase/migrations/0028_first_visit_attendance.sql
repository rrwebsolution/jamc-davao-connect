-- ============================================================================
-- JAMC Davao Connect — 0028 A visitor's first visit counts as attendance
--
-- Registering a visitor records when they first came and to which service
-- (visitor_profiles.first_visit_date and attendance_type_id), but that visit
-- was never an attendance mark. So the dashboard counted the visitor while
-- Attendance Records, which counts marks, showed no visitors at all.
--
-- Now the visit is marked Present in that day's session of that type:
--   - when the visitor is registered (or their visit date or service changes)
--     and the session already exists, and
--   - when the session is created (or moved to that day or type) afterwards.
-- Nothing is overwritten: a mark someone already gave that visitor in that
-- session stays as it is. Without a service type on the visit nothing is
-- guessed. Marks are never removed automatically.
--
-- These run as the database owner because whoever registers a visitor may not
-- be allowed to record attendance; they only ever add this one Present mark.
-- ============================================================================

-- The session a first visit belongs to: that day, that type, not archived.
-- A church-wide session is preferred over a cell group's.
create or replace function public.first_visit_session(p_date date, p_type uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.attendance_sessions s
  where p_date is not null and p_type is not null
    and s.session_date = p_date
    and s.attendance_type_id = p_type
    and s.archived_at is null
  order by (s.cell_group_id is not null), s.created_at
  limit 1;
$$;

-- "Present" if there is a status of that name, otherwise the first status that counts as present.
create or replace function public.present_status_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select st.id
  from public.attendance_statuses st
  where st.counts_as_present
  order by (st.name <> 'Present'), (not st.is_active), st.sort_order, st.name
  limit 1;
$$;

-- Marks one person's first visit, if its session exists and they have no mark there yet.
-- Returns whether a mark was added.
create or replace function public.mark_first_visit(p_person uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  visit record;
  target_session uuid;
  present uuid;
  added integer;
begin
  select vp.first_visit_date, vp.attendance_type_id into visit
  from public.visitor_profiles vp
  join public.people p on p.id = vp.person_id
  where vp.person_id = p_person and p.archived_at is null;
  if not found then
    return false;
  end if;

  target_session := public.first_visit_session(visit.first_visit_date, visit.attendance_type_id);
  present := public.present_status_id();
  if target_session is null or present is null then
    return false;
  end if;

  insert into public.attendance_records (session_id, person_id, status_id, notes)
  values (target_session, p_person, present, 'First visit')
  on conflict (session_id, person_id) do nothing;
  get diagnostics added = row_count;
  return added > 0;
end;
$$;

create or replace function public.visitor_profiles_mark_first_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.mark_first_visit(new.person_id);
  return new;
end;
$$;

create trigger visitor_profiles_mark_first_visit
  after insert or update of first_visit_date, attendance_type_id on public.visitor_profiles
  for each row execute function public.visitor_profiles_mark_first_visit();

create or replace function public.attendance_sessions_mark_first_visits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  visitor uuid;
begin
  if new.archived_at is not null then
    return new;
  end if;
  for visitor in
    select vp.person_id
    from public.visitor_profiles vp
    where vp.first_visit_date = new.session_date
      and vp.attendance_type_id = new.attendance_type_id
      -- Only for the session the visit belongs to, when there are several that day.
      and public.first_visit_session(vp.first_visit_date, vp.attendance_type_id) = new.id
  loop
    perform public.mark_first_visit(visitor);
  end loop;
  return new;
end;
$$;

create trigger attendance_sessions_mark_first_visits
  after insert or update of session_date, attendance_type_id, archived_at on public.attendance_sessions
  for each row execute function public.attendance_sessions_mark_first_visits();

-- ---------------------------------------------------------------------------
-- One-off catch-up for visitors registered before this migration:
--   select public.backfill_first_visit_marks(true);   -- how many would be added
--   select public.backfill_first_visit_marks(false);  -- add them
-- Used by scripts/first-visit-backfill.mjs; not callable through the API.
-- ---------------------------------------------------------------------------
create or replace function public.backfill_first_visit_marks(p_dry_run boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  visitor uuid;
  total integer := 0;
begin
  if p_dry_run then
    select count(*) into total
    from public.visitor_profiles vp
    join public.people p on p.id = vp.person_id and p.archived_at is null
    where public.first_visit_session(vp.first_visit_date, vp.attendance_type_id) is not null
      and not exists (
        select 1 from public.attendance_records r
        where r.person_id = vp.person_id
          and r.session_id = public.first_visit_session(vp.first_visit_date, vp.attendance_type_id)
      );
    return total;
  end if;

  for visitor in select vp.person_id from public.visitor_profiles vp loop
    if public.mark_first_visit(visitor) then
      total := total + 1;
    end if;
  end loop;
  return total;
end;
$$;

revoke execute on function public.first_visit_session(date, uuid) from public, anon, authenticated;
revoke execute on function public.present_status_id() from public, anon, authenticated;
revoke execute on function public.mark_first_visit(uuid) from public, anon, authenticated;
revoke execute on function public.visitor_profiles_mark_first_visit() from public, anon, authenticated;
revoke execute on function public.attendance_sessions_mark_first_visits() from public, anon, authenticated;
revoke execute on function public.backfill_first_visit_marks(boolean) from public, anon, authenticated;
