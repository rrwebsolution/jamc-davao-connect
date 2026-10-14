-- ============================================================================
-- JAMC Davao Connect — 0023 Motion & animation settings
--
-- Part of System Appearance, so it lives in the same single row and reaches
-- every page (including the login page) through get_public_branding().
--
--   animations_enabled      master switch
--   animation_level         'off' | 'subtle' | 'normal' (how much movement)
--   scroll_reveal_enabled   whether content fades in as it scrolls into view
-- ============================================================================

alter table public.system_appearance_settings
  add column animations_enabled boolean not null default true,
  add column animation_level text not null default 'subtle'
    check (animation_level in ('off', 'subtle', 'normal')),
  add column scroll_reveal_enabled boolean not null default true;

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
  return new;
end;
$$;
