-- JAMC Davao Connect — 0016 adjustable logo sizes
--
-- Heights in pixels. The church logo size applies to the sidebar (and scales
-- the logo on the login page's welcome panel); the login logo size applies
-- above the sign-in form. get_public_branding() returns the whole row, so the
-- new columns reach the app without changing that function.

alter table public.system_appearance_settings
  add column logo_size integer not null default 32 check (logo_size between 20 and 48),
  add column login_logo_size integer not null default 56 check (login_logo_size between 32 and 160);
