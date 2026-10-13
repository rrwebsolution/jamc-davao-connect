-- JAMC Davao Connect — 0007 storage buckets and policies

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Logos, favicon and login background. Public so the login page can show them.
  ('branding', 'branding', true, 2097152,
   array['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']),
  -- Member and visitor photos. Private: served through short-lived signed URLs.
  ('people-photos', 'people-photos', false, 2097152,
   array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create index people_photo_path_idx on public.people (photo_path) where photo_path is not null;

-- Branding: only appearance managers can list, upload, replace or remove.
create policy branding_select on storage.objects for select to authenticated
  using (bucket_id = 'branding' and (select public.has_permission('appearance.manage')));
create policy branding_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and (select public.has_permission('appearance.manage')));
create policy branding_update on storage.objects for update to authenticated
  using (bucket_id = 'branding' and (select public.has_permission('appearance.manage')))
  with check (bucket_id = 'branding' and (select public.has_permission('appearance.manage')));
create policy branding_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and (select public.has_permission('appearance.manage')));

-- People photos: a photo is readable exactly when the person it belongs to is
-- visible to the caller (the subquery runs under the caller's people RLS).
create policy people_photos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'people-photos'
    and exists (select 1 from public.people p where p.photo_path = storage.objects.name)
  );
create policy people_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'people-photos'
    and (
      (select public.has_permission('members.create'))
      or (select public.has_permission('members.update'))
      or (select public.has_permission('visitors.create'))
      or (select public.has_permission('visitors.update'))
    )
  );
create policy people_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'people-photos'
    and (
      (select public.has_permission('members.update'))
      or (select public.has_permission('visitors.update'))
    )
  );
