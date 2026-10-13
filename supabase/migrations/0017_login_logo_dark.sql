-- JAMC Davao Connect — 0017 separate login logo for dark mode
--
-- The sign-in form sits on the page background, which is light in light mode
-- and dark in dark mode. One logo rarely reads well on both, so there are two:
--   login_logo_path       shown in light mode (use a dark or full-colour logo)
--   login_logo_dark_path  shown in dark mode  (use a light or white logo)

alter table public.system_appearance_settings
  add column login_logo_dark_path text;
