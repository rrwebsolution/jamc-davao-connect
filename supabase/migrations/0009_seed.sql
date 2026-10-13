-- JAMC Davao Connect — 0009 seed: default configuration (no people, no fake data)

insert into public.church_settings (id) values (true) on conflict (id) do nothing;
insert into public.system_appearance_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
insert into public.roles (key, name, description, is_system) values
  ('super_admin', 'Super Admin', 'Complete access to the whole system.', true),
  ('pastor', 'Pastor', 'Church-wide access to people, attendance, groups, care and reports.', true),
  ('cell_leader', 'Cell Leader', 'Access limited to the cell groups they lead.', true),
  ('member', 'Member', 'Limited portal: own profile, group and activities.', true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, module, description, sort_order) values
  ('members.view', 'Members', 'View all members', 10),
  ('members.view_assigned', 'Members', 'View members of the cell groups they lead', 11),
  ('members.create', 'Members', 'Add members and convert visitors', 12),
  ('members.update', 'Members', 'Edit member records', 13),
  ('members.archive', 'Members', 'Archive and restore members', 14),
  ('visitors.view', 'Visitors', 'View visitors', 20),
  ('visitors.create', 'Visitors', 'Register visitors', 21),
  ('visitors.update', 'Visitors', 'Edit and archive visitors', 22),
  ('attendance.view', 'Attendance', 'View all attendance', 30),
  ('attendance.view_assigned', 'Attendance', 'View attendance of the cell groups they lead', 31),
  ('attendance.create', 'Attendance', 'Create sessions and record attendance', 32),
  ('attendance.update', 'Attendance', 'Change or remove recorded attendance', 33),
  ('attendance.manage_assigned', 'Attendance', 'Record attendance for the cell groups they lead', 34),
  ('groups.view', 'Cell Groups', 'View all cell groups', 40),
  ('groups.manage', 'Cell Groups', 'Create and edit cell groups', 41),
  ('care.view', 'Care', 'View follow-ups and care records', 50),
  ('care.manage', 'Care', 'Create and edit follow-ups and care records', 51),
  ('care.confidential', 'Care', 'Access confidential pastoral notes', 52),
  ('discipleship.view', 'Discipleship', 'View discipleship records', 60),
  ('discipleship.manage', 'Discipleship', 'Manage discipleship records and stages', 61),
  ('ministries.view', 'Ministries', 'View ministries and assignments', 70),
  ('ministries.manage', 'Ministries', 'Create and edit ministries and assignments', 71),
  ('events.view', 'Events', 'View events and activities', 80),
  ('events.manage', 'Events', 'Create and edit events', 81),
  ('finance.view', 'Finance', 'View giving and expenses', 90),
  ('finance.manage', 'Finance', 'Record giving and expenses', 91),
  ('reports.view', 'Reports', 'View reports', 100),
  ('reports.export', 'Reports', 'Export reports', 101),
  ('users.manage', 'Administration', 'Create users and assign roles', 110),
  ('roles.manage', 'Administration', 'Manage roles and permissions', 111),
  ('logs.view', 'Administration', 'View activity logs', 112),
  ('settings.manage', 'Administration', 'Change system settings', 113),
  ('appearance.manage', 'Administration', 'Change branding and theme', 114)
on conflict (key) do nothing;

-- Super Admin is granted everything explicitly as well, so the Roles screen
-- shows it. (is_super_admin() already short-circuits every check.)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.key = 'super_admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'members.view', 'members.create', 'members.update', 'members.archive',
  'visitors.view', 'visitors.create', 'visitors.update',
  'attendance.view', 'attendance.create', 'attendance.update',
  'groups.view', 'groups.manage',
  'care.view', 'care.manage',
  'discipleship.view', 'discipleship.manage',
  'ministries.view', 'ministries.manage',
  'events.view', 'events.manage',
  'reports.view', 'reports.export'
)
where r.key = 'pastor'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'members.view_assigned', 'attendance.view_assigned', 'attendance.manage_assigned', 'events.view'
)
where r.key = 'cell_leader'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in ('events.view')
where r.key = 'member'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Lookups (all editable from Settings)
-- ---------------------------------------------------------------------------
insert into public.membership_statuses (name, is_default, sort_order) values
  ('Regular Member', true, 10),
  ('New Member', false, 20),
  ('Regular Attendee', false, 30),
  ('Transferred', false, 40),
  ('Inactive', false, 50)
on conflict (name) do nothing;

insert into public.baptism_statuses (name, is_default, sort_order) values
  ('Not Baptized', true, 10),
  ('Scheduled', false, 20),
  ('Baptized', false, 30)
on conflict (name) do nothing;

insert into public.attendance_types (name, counts_for_absence, sort_order) values
  ('Sunday Service', true, 10),
  ('Prayer Meeting', false, 20),
  ('Cell Meeting', false, 30),
  ('Special Event', false, 40),
  ('Other', false, 50)
on conflict (name) do nothing;

insert into public.attendance_statuses (name, counts_as_present, sort_order) values
  ('Present', true, 10),
  ('Late', true, 20),
  ('Absent', false, 30),
  ('Excused', false, 40)
on conflict (name) do nothing;

insert into public.discipleship_stages (name, sort_order) values
  ('New Visitor', 10),
  ('Connected', 20),
  ('New Believer', 30),
  ('Foundation', 40),
  ('Growing Disciple', 50),
  ('Serving', 60),
  ('Apprentice Leader', 70),
  ('Cell Leader', 80),
  ('Mentor', 90)
on conflict (name) do nothing;

insert into public.ministries (name, sort_order) values
  ('Worship', 10),
  ('Media', 20),
  ('Ushers', 30),
  ('Kids Ministry', 40),
  ('Youth', 50),
  ('Prayer Team', 60),
  ('Music', 70),
  ('Administration', 80)
on conflict (name) do nothing;

-- Seeding is not user activity.
delete from public.activity_logs;
