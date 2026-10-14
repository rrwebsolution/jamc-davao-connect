-- ============================================================================
-- JAMC Davao Connect — 0022 Rows per page
--
-- How many rows each paginated list shows (Members, Visitors, Attendance,
-- Follow-ups, Finance, Activity Logs, ...). One system-wide setting, kept with
-- the other general settings. Limited to a few sensible sizes so a list can
-- neither be uselessly short nor load thousands of rows at once.
-- ============================================================================

alter table public.church_settings
  add column rows_per_page integer not null default 20
    check (rows_per_page in (10, 20, 25, 50, 100));
