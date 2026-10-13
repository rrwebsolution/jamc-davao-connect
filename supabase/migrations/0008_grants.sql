-- JAMC Davao Connect — 0008 grants
--
-- Explicit grants so the result does not depend on a project's default
-- privileges. RLS decides which rows; these decide which objects at all.

revoke all on all tables in schema public from anon, public;
revoke all on all sequences in schema public from anon, public;
revoke execute on all functions in schema public from anon, public;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- The only thing an anonymous visitor may call.
grant execute on function public.get_public_branding() to anon;

-- Activity logs are append-only: rows come from audit triggers only.
revoke insert, update, delete on public.activity_logs from authenticated;

-- Profiles are created by the auth trigger and removed with the auth user.
revoke insert, delete on public.profiles from authenticated;
