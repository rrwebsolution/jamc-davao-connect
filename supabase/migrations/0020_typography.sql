-- ============================================================================
-- JAMC Davao Connect — 0020 Typography settings
--
-- Typography is part of System Appearance, so it lives in the same single row
-- (system_appearance_settings). get_public_branding() returns the whole row,
-- so the login page and the root layout pick these up with no further change.
--
-- Fonts are chosen from a fixed list; there is no free-text font or URL.
-- Sizes are in pixels at the 16px base and are limited to readable ranges.
-- ============================================================================

alter table public.system_appearance_settings
  add column primary_font text not null default 'inter'
    check (primary_font in ('inter', 'roboto', 'open_sans', 'lato', 'poppins', 'montserrat', 'nunito', 'source_sans_3', 'dm_sans', 'manrope', 'system')),
  add column heading_font text not null default 'same'
    check (heading_font in ('same', 'inter', 'roboto', 'open_sans', 'lato', 'poppins', 'montserrat', 'nunito', 'source_sans_3', 'dm_sans', 'manrope', 'system')),
  add column base_font_size integer not null default 16 check (base_font_size between 14 and 20),
  add column body_font_weight integer not null default 400 check (body_font_weight in (300, 400, 500)),
  add column heading_font_weight integer not null default 600 check (heading_font_weight in (400, 500, 600, 700)),
  add column heading_scale text not null default 'normal' check (heading_scale in ('compact', 'normal', 'large')),
  add column mobile_font_scale text not null default 'normal' check (mobile_font_scale in ('compact', 'normal', 'comfortable')),
  add column page_title_font_size integer not null default 24 check (page_title_font_size between 20 and 32),
  add column section_title_font_size integer not null default 16 check (section_title_font_size between 14 and 24),
  add column card_title_font_size integer not null default 16 check (card_title_font_size between 14 and 20),
  add column body_font_size integer not null default 16 check (body_font_size between 14 and 18),
  add column small_font_size integer not null default 14 check (small_font_size between 12 and 16),
  add column caption_font_size integer not null default 12 check (caption_font_size between 11 and 14),
  add column button_font_size integer not null default 14 check (button_font_size between 12 and 18),
  add column input_font_size integer not null default 14 check (input_font_size between 12 and 18),
  add column table_font_size integer not null default 14 check (table_font_size between 12 and 18),
  add column sidebar_font_size integer not null default 14 check (sidebar_font_size between 12 and 18);

-- ---------------------------------------------------------------------------
-- Activity log: say which part of the appearance changed. Only saved changes
-- reach the database, so previewing never writes a log entry.
-- ---------------------------------------------------------------------------
create or replace function public.audit_appearance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  typography_keys text[] := array[
    'primary_font', 'heading_font', 'base_font_size', 'body_font_weight', 'heading_font_weight',
    'heading_scale', 'mobile_font_scale', 'page_title_font_size', 'section_title_font_size',
    'card_title_font_size', 'body_font_size', 'small_font_size', 'caption_font_size',
    'button_font_size', 'input_font_size', 'table_font_size', 'sidebar_font_size'
  ];
  new_data jsonb := to_jsonb(new) - 'updated_at' - 'updated_by';
  old_data jsonb := to_jsonb(old) - 'updated_at' - 'updated_by';
begin
  if (new_data - typography_keys) is distinct from (old_data - typography_keys) then
    insert into public.activity_logs (user_id, action, module, record_id, description)
    values (auth.uid(), 'updated', 'appearance', 'true', 'Branding and theme updated');
  end if;
  if (select jsonb_object_agg(key, value) from jsonb_each(new_data) where key = any (typography_keys))
     is distinct from
     (select jsonb_object_agg(key, value) from jsonb_each(old_data) where key = any (typography_keys)) then
    insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
    values (auth.uid(), 'updated', 'appearance', 'true', 'Typography', 'Updated system typography');
  end if;
  return new;
end;
$$;

drop trigger system_appearance_settings_audit on public.system_appearance_settings;
create trigger system_appearance_settings_audit after update on public.system_appearance_settings
  for each row execute function public.audit_appearance();
