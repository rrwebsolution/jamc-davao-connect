-- ============================================================================
-- JAMC Davao Connect — 0024 System background image
--
-- A picture behind the signed-in application (Dashboard, Members, ...). It is
-- separate from the login background, which stays as it is. Part of System
-- Appearance, so it lives in the same single row. Only the Storage path is
-- kept here; the picture itself is a file in the `branding` bucket.
--
-- The overlay (a colour laid over the picture, one for light mode and one for
-- dark) is what keeps the content readable, so its limits are generous but
-- the surfaces can never drop below 70% opaque.
-- ============================================================================

alter table public.system_appearance_settings
  add column system_background_path text,
  add column system_background_enabled boolean not null default false,
  add column background_size text not null default 'cover'
    check (background_size in ('cover', 'contain', 'auto')),
  add column background_position text not null default 'center'
    check (background_position in ('center', 'top', 'bottom', 'left', 'right', 'top_left', 'top_right', 'bottom_left', 'bottom_right')),
  add column background_overlay_enabled boolean not null default true,
  add column background_overlay_color_light text not null default '#FFFFFF'
    check (background_overlay_color_light ~ '^#[0-9A-Fa-f]{6}$'),
  add column background_overlay_color_dark text not null default '#000000'
    check (background_overlay_color_dark ~ '^#[0-9A-Fa-f]{6}$'),
  add column background_overlay_opacity_light integer not null default 75
    check (background_overlay_opacity_light between 0 and 100),
  add column background_overlay_opacity_dark integer not null default 65
    check (background_overlay_opacity_dark between 0 and 100),
  add column background_blur integer not null default 0 check (background_blur between 0 and 10),
  add column background_brightness integer not null default 100 check (background_brightness between 50 and 120),
  add column card_background_style text not null default 'solid'
    check (card_background_style in ('solid', 'translucent')),
  add column sidebar_opacity integer not null default 100 check (sidebar_opacity between 70 and 100),
  add column navbar_opacity integer not null default 100 check (navbar_opacity between 70 and 100);

-- Activity log: one entry per part of the appearance that was saved.
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
  login_keys text[] := array[
    'login_welcome_message', 'show_login_welcome_message', 'login_bible_verse',
    'login_bible_verse_reference', 'show_login_bible_verse'
  ];
  motion_keys text[] := array['animations_enabled', 'animation_level', 'scroll_reveal_enabled'];
  background_keys text[] := array[
    'system_background_path', 'system_background_enabled', 'background_size', 'background_position',
    'background_overlay_enabled', 'background_overlay_color_light', 'background_overlay_color_dark',
    'background_overlay_opacity_light', 'background_overlay_opacity_dark', 'background_blur',
    'background_brightness', 'card_background_style', 'sidebar_opacity', 'navbar_opacity'
  ];
  new_data jsonb := to_jsonb(new) - 'updated_at' - 'updated_by';
  old_data jsonb := to_jsonb(old) - 'updated_at' - 'updated_by';
  changed text[];
begin
  select coalesce(array_agg(n.key), '{}') into changed
  from jsonb_each(new_data) n
  where n.value is distinct from old_data -> n.key;

  if exists (
    select 1 from unnest(changed) k
    where k <> all (typography_keys) and k <> all (login_keys) and k <> all (motion_keys) and k <> all (background_keys)
  ) then
    insert into public.activity_logs (user_id, action, module, record_id, description)
    values (auth.uid(), 'updated', 'appearance', 'true', 'Branding and theme updated');
  end if;
  if changed && typography_keys then
    insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
    values (auth.uid(), 'updated', 'appearance', 'true', 'Typography', 'Updated system typography');
  end if;
  -- Only that it changed: the text itself is on the login page for anyone to read.
  if changed && login_keys then
    insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
    values (auth.uid(), 'updated', 'appearance', 'true', 'Login page content', 'Updated login page content');
  end if;
  if changed && motion_keys then
    insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
    values (auth.uid(), 'updated', 'appearance', 'true', 'Motion', 'Updated motion and animation settings');
  end if;
  if changed && background_keys then
    insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
    values (auth.uid(), 'updated', 'appearance', 'true', 'Background', 'Updated system background appearance');
  end if;
  return new;
end;
$$;
