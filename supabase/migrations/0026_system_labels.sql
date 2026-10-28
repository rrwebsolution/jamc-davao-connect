-- ============================================================================
-- JAMC Davao Connect — 0026 System labels
--
-- The names in the navigation and the titles and descriptions of each page
-- can be renamed from Settings (for example "Cell Groups" to "Life Groups").
-- Only the changed ones are stored, as { "<original text>": "<new text>" };
-- anything not in the object keeps the text written in the app. Part of System
-- Appearance, so it lives in the same single row, and get_public_branding()
-- returns it with the rest. The labels are not confidential.
-- ============================================================================

-- An object of text values, each at most 300 characters. A pure check with no
-- access to any table, so it needs no security definer.
create or replace function public.ui_labels_valid(labels jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(labels) = 'object'
    and length(labels::text) <= 20000
    and not exists (
      select 1 from jsonb_each(labels) e
      where jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 300 or char_length(e.key) > 300
    );
$$;

alter table public.system_appearance_settings
  add column ui_labels jsonb not null default '{}'::jsonb check (public.ui_labels_valid(ui_labels));

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
  label_keys text[] := array['ui_labels'];
  new_data jsonb := to_jsonb(new) - 'updated_at' - 'updated_by';
  old_data jsonb := to_jsonb(old) - 'updated_at' - 'updated_by';
  changed text[];
begin
  select coalesce(array_agg(n.key), '{}') into changed
  from jsonb_each(new_data) n
  where n.value is distinct from old_data -> n.key;

  if exists (
    select 1 from unnest(changed) k
    where k <> all (typography_keys) and k <> all (login_keys) and k <> all (motion_keys)
      and k <> all (background_keys) and k <> all (label_keys)
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
  if changed && label_keys then
    insert into public.activity_logs (user_id, action, module, record_id, record_label, description)
    values (auth.uid(), 'updated', 'appearance', 'true', 'Labels', 'Updated system labels');
  end if;
  return new;
end;
$$;
