-- ============================================================================
-- JAMC Davao Connect — 0021 Login page content
--
-- The welcome message and Bible verse beside the sign-in form become settings.
-- They live in the same single row as the rest of System Appearance, and
-- get_public_branding() returns the whole row, so the login page reads them
-- with no further change. The verse and its reference are separate columns so
-- they can be styled, and hidden, independently.
-- ============================================================================

alter table public.system_appearance_settings
  add column login_welcome_message text not null
    default 'Connecting people. Strengthening discipleship. Caring for every person.'
    check (char_length(login_welcome_message) <= 200),
  add column show_login_welcome_message boolean not null default true,
  add column login_bible_verse text not null
    default 'Let us consider how we may spur one another on toward love and good deeds.'
    check (char_length(login_bible_verse) <= 300),
  add column login_bible_verse_reference text not null default 'Hebrews 10:24'
    check (char_length(login_bible_verse_reference) <= 80),
  add column show_login_bible_verse boolean not null default true;

-- ---------------------------------------------------------------------------
-- Activity log: one entry per part of the appearance that was saved.
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
  login_keys text[] := array[
    'login_welcome_message', 'show_login_welcome_message', 'login_bible_verse',
    'login_bible_verse_reference', 'show_login_bible_verse'
  ];
  new_data jsonb := to_jsonb(new) - 'updated_at' - 'updated_by';
  old_data jsonb := to_jsonb(old) - 'updated_at' - 'updated_by';
  changed text[];
begin
  select coalesce(array_agg(n.key), '{}') into changed
  from jsonb_each(new_data) n
  where n.value is distinct from old_data -> n.key;

  if exists (select 1 from unnest(changed) k where k <> all (typography_keys) and k <> all (login_keys)) then
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
  return new;
end;
$$;
