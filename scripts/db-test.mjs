// Applies every migration to an in-memory Postgres (PGlite) and checks the
// row level security rules for each Phase 1 role.
//
//   npm run db:test
//
// Supabase's auth and storage schemas are stubbed with just enough structure
// for the migrations to apply. This verifies the SQL and the policies; it does
// not replace a check against the real project.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");

const db = new PGlite({ extensions: { pg_trgm } });

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}',
    last_sign_in_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text,
    owner uuid
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects to authenticated, service_role;
`);

for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
  try {
    await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    console.log(`applied  ${file}`);
  } catch (error) {
    console.error(`FAILED   ${file}\n  ${error.message}`);
    process.exit(1);
  }
}

// --- helpers ---------------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Run queries as a signed-in user (or as anon when userId is null). */
async function as(userId, fn) {
  await db.exec(`set role ${userId ? "authenticated" : "anon"}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async (sql, params = []) => (await db.query(sql, params)).rows.length;
const affected = async (sql, params = []) => (await db.query(sql, params)).affectedRows ?? 0;

async function denied(sql, params = []) {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
}

// --- fixtures (created as the database owner, like the service role) --------

async function makeUser(email, roleKey) {
  const [{ id }] = await rows(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: email.split("@")[0] })],
  );
  // Accounts start pending; these fixtures stand for ones an admin created.
  await db.query(
    `update public.profiles set approval_status = 'approved', account_status = 'active', registration_source = 'admin_created' where id = $1`,
    [id],
  );
  if (roleKey) {
    await db.query(
      `insert into public.user_roles (user_id, role_id)
       select $1, id from public.roles where key = $2`,
      [id, roleKey],
    );
  }
  return id;
}

async function makePerson(first, last, extra = {}) {
  const columns = ["first_name", "last_name", ...Object.keys(extra)];
  const values = [first, last, ...Object.values(extra)];
  const [{ id }] = await rows(
    `insert into public.people (${columns.join(", ")})
     values (${values.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    values,
  );
  return id;
}

const admin = await makeUser("admin@test.local", "super_admin");
const pastor = await makeUser("pastor@test.local", "pastor");
const leader = await makeUser("leader@test.local", "cell_leader");
const member = await makeUser("member@test.local", "member");
const nobody = await makeUser("nobody@test.local", null);

await db.exec(`
  insert into public.roles (key, name) values ('user_admin', 'User Admin');
  insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.key = 'users.manage'
  where r.key = 'user_admin';
`);
const userAdmin = await makeUser("useradmin@test.local", "user_admin");

const leaderPerson = await makePerson("Lea", "Leader", { user_id: leader });
const memberPerson = await makePerson("Mem", "Member", { user_id: member, birthdate: "1990-06-15" });
const inGroup = await makePerson("Ina", "Group");
const outsider = await makePerson("Otto", "Outside");
const visitor = await makePerson("Vic", "Visitor", { person_type: "visitor" });
await db.query(`insert into public.visitor_profiles (person_id, first_visit_date) values ($1, current_date)`, [visitor]);

const [{ id: group }] = await rows(
  `insert into public.cell_groups (name, leader_id) values ('Alpha', $1) returning id`,
  [leaderPerson],
);
const [{ id: otherGroup }] = await rows(`insert into public.cell_groups (name) values ('Beta') returning id`);
await db.query(
  `insert into public.cell_group_members (cell_group_id, person_id) values ($1, $2), ($1, $3), ($4, $5)`,
  [group, inGroup, memberPerson, otherGroup, outsider],
);

const [{ id: memberRole }] = await rows(`select id from public.roles where key = 'member'`);
const [{ id: sundayType }] = await rows(`select id from public.attendance_types where name = 'Sunday Service'`);
const [{ id: cellType }] = await rows(`select id from public.attendance_types where name = 'Cell Meeting'`);
const [{ id: present }] = await rows(`select id from public.attendance_statuses where name = 'Present'`);
const [{ id: absent }] = await rows(`select id from public.attendance_statuses where name = 'Absent'`);

const [{ id: sunday }] = await rows(
  `insert into public.attendance_sessions (attendance_type_id, title, session_date)
   values ($1, 'Sunday Service', current_date - 7) returning id`,
  [sundayType],
);
await db.query(
  `insert into public.attendance_records (session_id, person_id, status_id)
   values ($1, $2, $5), ($1, $3, $6), ($1, $4, $5)`,
  [sunday, memberPerson, inGroup, outsider, present, absent],
);

// --- schema behaviour ------------------------------------------------------

const [codeRow] = await rows(`select member_code from public.people where id = $1`, [inGroup]);
check("member code is generated", /^JAMC-\d{5}$/.test(codeRow.member_code ?? ""), codeRow.member_code);
const [visitorRow] = await rows(`select member_code from public.people where id = $1`, [visitor]);
check("visitors get no member code", visitorRow.member_code === null);
check("every user gets a profile", (await count(`select 1 from public.profiles`)) === 6);

// --- anon ------------------------------------------------------------------

await as(null, async () => {
  check("anon: cannot read people", await denied(`select 1 from public.people`));
  check("anon: cannot read church settings", await denied(`select 1 from public.church_settings`));
  check("anon: cannot call has_permission", await denied(`select public.has_permission('members.view')`));
  const [{ b }] = await rows(`select public.get_public_branding() as b`);
  check("anon: can read public branding", b?.system_name === "JAMC Davao Connect" && b?.church_name === "JAMC-Davao");
  check("anon: branding hides bookkeeping columns", !("updated_by" in b) && !("id" in b));
});

// --- signed in without any role ---------------------------------------------

await as(nobody, async () => {
  check("no role: sees no people", (await count(`select 1 from public.people`)) === 0);
  check("no role: sees no attendance", (await count(`select 1 from public.attendance_records`)) === 0);
  check("no role: sees no cell groups", (await count(`select 1 from public.cell_groups`)) === 0);
  check(
    "no role: cannot add a member",
    await denied(`insert into public.people (first_name, last_name) values ('X', 'Y')`),
  );
  check("no role: sees no roles", (await count(`select 1 from public.roles`)) === 0);
});

// --- pastor ----------------------------------------------------------------

await as(pastor, async () => {
  check("pastor: sees all members and visitors", (await count(`select 1 from public.people`)) === 5);
  check("pastor: sees all attendance", (await count(`select 1 from public.attendance_records`)) === 3);
  check(
    "pastor: can add a member",
    (await affected(`insert into public.people (first_name, last_name) values ('New', 'Member')`)) === 1,
  );
  check(
    "pastor: can archive a member",
    (await affected(`update public.people set archived_at = now() where full_name = 'New Member'`)) === 1,
  );
  check("pastor: cannot read activity logs", (await count(`select 1 from public.activity_logs`)) === 0);
  check(
    "pastor: cannot change church settings",
    (await affected(`update public.church_settings set church_name = 'Hacked'`)) === 0,
  );
  check(
    "pastor: cannot change appearance",
    (await affected(`update public.system_appearance_settings set primary_color = '#000000'`)) === 0,
  );
  check("pastor: can read appearance", (await count(`select 1 from public.system_appearance_settings`)) === 1);
  check("pastor: cannot see roles", (await count(`select 1 from public.roles`)) === 0);
  check(
    "pastor: cannot assign roles",
    await denied(`insert into public.user_roles (user_id, role_id) values ($1, $2)`, [nobody, memberRole]),
  );
  check(
    "pastor: cannot deactivate a user",
    (await affected(`update public.profiles set is_active = false where id = $1`, [member])) === 0,
  );
  check(
    "pastor: cannot change lookups",
    await denied(`insert into public.membership_statuses (name) values ('Sneaky')`),
  );
  check(
    "pastor: cannot delete people",
    (await affected(`delete from public.people where id = $1`, [outsider])) === 0,
  );
  check(
    "pastor: cannot link a person to a login",
    await denied(`update public.people set user_id = $1 where id = $2`, [nobody, outsider]),
  );
  const [{ s }] = await rows(`select public.dashboard_stats() as s`);
  check("pastor: dashboard counts members", s.total_members === 4 && s.active_cell_groups === 2, JSON.stringify(s).slice(0, 200));
  check("pastor: dashboard reads latest service", s.latest_service?.present === 2);
  check("pastor: dashboard has 12 months of growth", s.membership_growth.length === 12);
});

// --- cell leader ------------------------------------------------------------

await as(leader, async () => {
  const names = (await rows(`select full_name from public.people order by full_name`)).map((r) => r.full_name);
  check(
    "leader: sees only own group and self",
    JSON.stringify(names) === JSON.stringify(["Ina Group", "Lea Leader", "Mem Member"]),
    names.join(", "),
  );
  check("leader: sees no visitors", (await count(`select 1 from public.people where person_type = 'visitor'`)) === 0);
  check("leader: sees only own group", (await count(`select 1 from public.cell_groups`)) === 1);
  check(
    "leader: cannot edit a member",
    (await affected(`update public.people set nickname = 'x' where id = $1`, [inGroup])) === 0,
  );
  check(
    "leader: sees attendance of own group only",
    (await count(`select 1 from public.attendance_records`)) === 2,
  );
  check("leader: sees the session those records belong to", (await count(`select 1 from public.attendance_sessions`)) === 1);
  check(
    "leader: cannot create a Sunday service session",
    await denied(
      `insert into public.attendance_sessions (attendance_type_id, title, session_date) values ($1, 'X', current_date)`,
      [sundayType],
    ),
  );
  check(
    "leader: cannot create a session for another group",
    await denied(
      `insert into public.attendance_sessions (attendance_type_id, title, session_date, cell_group_id)
       values ($1, 'X', current_date, $2)`,
      [cellType, otherGroup],
    ),
  );
  const [{ id: cellSession }] = await rows(
    `insert into public.attendance_sessions (attendance_type_id, title, session_date, cell_group_id)
     values ($1, 'Alpha weekly', current_date, $2) returning id`,
    [cellType, group],
  );
  check("leader: can create a session for own group", Boolean(cellSession));
  check(
    "leader: can record attendance for a group member",
    (await affected(
      `insert into public.attendance_records (session_id, person_id, status_id) values ($1, $2, $3)`,
      [cellSession, inGroup, present],
    )) === 1,
  );
  check(
    "leader: cannot record attendance for someone outside the group",
    await denied(
      `insert into public.attendance_records (session_id, person_id, status_id) values ($1, $2, $3)`,
      [cellSession, outsider, present],
    ),
  );
  check(
    "leader: cannot change Sunday service attendance",
    (await affected(`update public.attendance_records set status_id = $1 where session_id = $2`, [present, sunday])) === 0,
  );
  check(
    "leader: cannot convert a visitor",
    await denied(`select public.convert_visitor_to_member($1)`, [visitor]),
  );
  const [{ s }] = await rows(`select public.dashboard_stats() as s`);
  check("leader: dashboard is scoped to own group", s.total_members === 3 && s.active_cell_groups === 1);
});

// --- member -----------------------------------------------------------------

await as(member, async () => {
  const names = (await rows(`select full_name from public.people`)).map((r) => r.full_name);
  check("member: sees only own record", JSON.stringify(names) === JSON.stringify(["Mem Member"]), names.join(", "));
  check("member: sees own attendance only", (await count(`select 1 from public.attendance_records`)) === 1);
  check("member: sees own cell group", (await count(`select 1 from public.cell_groups`)) === 1);
  check(
    "member: cannot edit own record directly",
    (await affected(`update public.people set is_active = false where id = $1`, [memberPerson])) === 0,
  );
  await db.query(`select public.update_my_person('Memmy', '0917', 'mem@test.local', 'Davao')`);
  const [{ nickname }] = await rows(`select nickname from public.people where id = $1`, [memberPerson]);
  check("member: can update own contact details", nickname === "Memmy");
  check(
    "member: cannot deactivate self or change email",
    await denied(`update public.profiles set email = 'x@x.x' where id = $1`, [member]),
  );
  check(
    "member: can update own display name",
    (await affected(`update public.profiles set full_name = 'Mem M.' where id = $1`, [member])) === 1,
  );
  check("member: sees only own profile", (await count(`select 1 from public.profiles`)) === 1);
  const [{ a }] = await rows(`select public.get_my_access() as a`);
  check(
    "member: access payload lists own permissions only",
    JSON.stringify(a.permissions) === JSON.stringify(["events.view"]) && a.person_id === memberPerson,
    JSON.stringify(a.permissions),
  );
  const [{ st }] = await rows(`select public.person_attendance_stats($1) as st`, [memberPerson]);
  check("member: own attendance stats", st.total === 1 && st.present === 1 && st.consecutive_absences === 0);
});

// --- user admin (users.manage but not Super Admin) --------------------------

await as(userAdmin, async () => {
  check(
    "user admin: can assign an ordinary role",
    (await affected(
      `insert into public.user_roles (user_id, role_id) select $1, id from public.roles where key = 'member'`,
      [nobody],
    )) === 1,
  );
  check(
    "user admin: cannot grant Super Admin",
    await denied(
      `insert into public.user_roles (user_id, role_id) select $1, id from public.roles where key = 'super_admin'`,
      [nobody],
    ),
  );
  check(
    "user admin: cannot revoke Super Admin",
    await denied(`delete from public.user_roles where user_id = $1`, [admin]),
  );
  check(
    "user admin: cannot edit role permissions",
    await denied(
      `insert into public.role_permissions (role_id, permission_id)
       select r.id, p.id from public.roles r, public.permissions p
       where r.key = 'user_admin' and p.key = 'finance.view'`,
    ),
  );
});

// --- super admin ------------------------------------------------------------

await as(admin, async () => {
  check("admin: sees everyone", (await count(`select 1 from public.people`)) === 6);
  check("admin: can read activity logs", (await count(`select 1 from public.activity_logs`)) > 0);
  check(
    "admin: cannot write activity logs",
    await denied(
      `insert into public.activity_logs (action, module, description) values ('x', 'x', 'forged')`,
    ),
  );
  check("admin: cannot delete activity logs", await denied(`delete from public.activity_logs`));
  check(
    "admin: can change appearance",
    (await affected(`update public.system_appearance_settings set primary_color = '#123456'`)) === 1,
  );
  check(
    "admin: invalid colour is rejected",
    await denied(`update public.system_appearance_settings set primary_color = 'red'`),
  );
  check(
    "admin: last Super Admin cannot be removed",
    await denied(`delete from public.user_roles where user_id = $1`, [admin]),
  );
  check(
    "admin: cannot deactivate own account",
    await denied(`update public.profiles set is_active = false where id = $1`, [admin]),
  );
  check(
    "admin: system roles cannot be deleted",
    await denied(`delete from public.roles where key = 'pastor'`),
  );
  check(
    "admin: theme change is logged",
    (await count(`select 1 from public.activity_logs where module = 'appearance' and user_id = $1`, [admin])) === 1,
  );
  const upcoming = await rows(`select * from public.upcoming_birthdays(366)`);
  check("admin: upcoming birthdays", upcoming.length === 1 && upcoming[0].full_name === "Mem Member");
});

// --- conversion keeps one person and their history ---------------------------

await db.query(
  `insert into public.attendance_records (session_id, person_id, status_id) values ($1, $2, $3)`,
  [sunday, visitor, present],
);
await as(pastor, async () => {
  await db.query(`select public.convert_visitor_to_member($1)`, [visitor]);
  const [p] = await rows(`select person_type, member_code, membership_date from public.people where id = $1`, [visitor]);
  check("convert: same row becomes a member", p?.person_type === "member" && Boolean(p.member_code) && Boolean(p.membership_date));
  const [v] = await rows(`select status from public.visitor_profiles where person_id = $1`, [visitor]);
  check("convert: visitor history is kept", v?.status === "became_member");
  check(
    "convert: attendance history is kept",
    (await count(`select 1 from public.attendance_records where person_id = $1`, [visitor])) === 1,
  );
  check("convert: cannot convert twice", await denied(`select public.convert_visitor_to_member($1)`, [visitor]));
  check(
    "convert: a member cannot go back to visitor",
    await denied(`update public.people set person_type = 'visitor' where id = $1`, [visitor]),
  );
});
check("convert: no duplicate person", (await count(`select 1 from public.people where full_name = 'Vic Visitor'`)) === 1);

// --- deactivated accounts lose access ---------------------------------------

await db.query(`update public.profiles set is_active = false where id = $1`, [pastor]);
await as(pastor, async () => {
  check("deactivated: sees no people", (await count(`select 1 from public.people`)) === 0);
  check("deactivated: sees no settings", (await count(`select 1 from public.church_settings`)) === 0);
});

// --- storage ----------------------------------------------------------------

await db.query(`update public.people set photo_path = 'in-group.jpg' where id = $1`, [inGroup]);
await db.query(`update public.people set photo_path = 'outsider.jpg' where id = $1`, [outsider]);
await db.exec(`
  insert into storage.objects (bucket_id, name) values
    ('people-photos', 'in-group.jpg'), ('people-photos', 'outsider.jpg'), ('branding', 'logo.png');
`);
await as(leader, async () => {
  const names = (await rows(`select name from storage.objects`)).map((r) => r.name);
  check("storage: leader sees only photos of people they lead", JSON.stringify(names) === JSON.stringify(["in-group.jpg"]), names.join(", "));
  check(
    "storage: leader cannot upload branding",
    await denied(`insert into storage.objects (bucket_id, name) values ('branding', 'x.png')`),
  );
});
await as(admin, async () => {
  check(
    "storage: admin can upload branding",
    (await affected(`insert into storage.objects (bucket_id, name) values ('branding', 'new.png')`)) === 1,
  );
});

// ===========================================================================
// Phases 2-4: care, discipleship, events, finance, notifications
// ===========================================================================

await db.query(`update public.profiles set is_active = true where id = $1`, [pastor]);
const pastor2 = await makeUser("pastor2@test.local", "pastor");
const [{ id: stage1 }] = await rows(`select id from public.discipleship_stages order by sort_order limit 1`);
const [{ id: stage2 }] = await rows(`select id from public.discipleship_stages order by sort_order offset 1 limit 1`);

// --- pastoral care confidentiality -------------------------------------------

let careTeam, pastorOnly, selected;
await as(pastor, async () => {
  const insert = async (level) =>
    (await rows(
      `insert into public.pastoral_care_records (person_id, summary, notes, confidentiality)
       values ($1, 'Summary', 'Private notes', $2) returning id`,
      [outsider, level],
    ))[0].id;
  careTeam = await insert("care_team");
  pastorOnly = await insert("pastor_only");
  selected = await insert("selected_leaders");
  await db.query(`insert into public.pastoral_care_access (record_id, user_id) values ($1, $2)`, [selected, leader]);
  check("care: the author sees all their records", (await count(`select 1 from public.pastoral_care_records`)) === 3);
});
await as(pastor2, async () => {
  const seen = (await rows(`select id from public.pastoral_care_records`)).map((r) => r.id);
  check("care: another pastor sees only Care Team records", seen.length === 1 && seen[0] === careTeam, String(seen.length));
  check("care: Pastor Only is not reachable through the view", (await count(`select 1 from public.pastoral_care_details where id = $1`, [pastorOnly])) === 0);
  check(
    "care: another pastor cannot edit a record they cannot see",
    (await affected(`update public.pastoral_care_records set notes = 'x' where id = $1`, [pastorOnly])) === 0,
  );
  check(
    "care: cannot grant themselves access to a record",
    await denied(`insert into public.pastoral_care_access (record_id, user_id) values ($1, $2)`, [pastorOnly, pastor2]),
  );
});
await as(leader, async () => {
  const seen = (await rows(`select id from public.pastoral_care_records`)).map((r) => r.id);
  check("care: a selected leader sees only the record shared with them", seen.length === 1 && seen[0] === selected, String(seen.length));
  check(
    "care: a cell leader cannot create care records",
    await denied(`insert into public.pastoral_care_records (person_id, summary) values ($1, 'x')`, [inGroup]),
  );
});
await as(member, async () => {
  check("care: members see no care records", (await count(`select 1 from public.pastoral_care_records`)) === 0);
});
await as(nobody, async () => {
  check("care: users without a role see no care records", (await count(`select 1 from public.pastoral_care_details`)) === 0);
});
await as(admin, async () => {
  check("care: Super Admin sees every care record", (await count(`select 1 from public.pastoral_care_records`)) === 3);
  check(
    "care: the activity log does not repeat care content",
    (await count(`select 1 from public.activity_logs where description ilike '%Private notes%' or description ilike '%Summary%'`)) === 0,
  );
});

// --- finance ------------------------------------------------------------------

await as(admin, async () => {
  await db.query(
    `insert into public.giving_records (giving_date, category_id, amount)
     select current_date, id, 1500 from public.giving_categories order by sort_order limit 1`,
  );
  await db.query(
    `insert into public.expenses (expense_date, category_id, description, amount)
     select current_date, id, 'Electric bill', 400 from public.expense_categories order by sort_order limit 1`,
  );
  const [{ s }] = await rows(`select public.finance_stats() as s`);
  check("finance: Super Admin sees totals", Number(s.total_giving) === 1500 && Number(s.balance) === 1100, JSON.stringify(s).slice(0, 120));
  check(
    "finance: amounts are not copied into the activity log",
    (await count(`select 1 from public.activity_logs where module = 'finance' and (description like '%1500%' or description ilike '%Electric%')`)) === 0,
  );
});
for (const [label, user] of [["pastor", pastor], ["cell leader", leader], ["member", member]]) {
  await as(user, async () => {
    check(`finance: ${label} sees no giving`, (await count(`select 1 from public.giving_records`)) === 0);
    check(`finance: ${label} sees no expenses through the view`, (await count(`select 1 from public.expense_details`)) === 0);
    check(`finance: ${label} sees no categories`, (await count(`select 1 from public.giving_categories`)) === 0);
    const [{ s }] = await rows(`select public.finance_stats() as s`);
    check(`finance: ${label} gets empty statistics`, Number(s.total_giving) === 0 && Number(s.balance) === 0);
    check(
      `finance: ${label} cannot record giving`,
      await denied(
        `insert into public.giving_records (giving_date, category_id, amount) values (current_date, gen_random_uuid(), 5)`,
      ),
    );
  });
}

// --- follow-ups and notifications ---------------------------------------------

let followUp;
await as(pastor, async () => {
  followUp = (await rows(
    `insert into public.follow_ups (person_id, follow_up_type, assigned_to, due_date)
     values ($1, 'call', $2, current_date - 1) returning id`,
    [outsider, member],
  ))[0].id;
  check("follow-ups: pastor can create one", Boolean(followUp));
});
await as(member, async () => {
  check("follow-ups: the assignee sees it", (await count(`select 1 from public.follow_ups`)) === 1);
  check(
    "follow-ups: the assignee can see who it is about",
    (await count(`select 1 from public.people where id = $1`, [outsider])) === 1,
  );
  check(
    "follow-ups: the assignee was notified",
    (await count(`select 1 from public.notifications where kind = 'follow_up'`)) === 1,
  );
  await db.query(`select public.refresh_my_notifications()`);
  await db.query(`select public.refresh_my_notifications()`);
  check(
    "notifications: overdue reminder is generated once",
    (await count(`select 1 from public.notifications where title = 'Follow-up overdue'`)) === 1,
  );
  check(
    "notifications: cannot be forged",
    await denied(`insert into public.notifications (user_id, kind, title) values ($1, 'x', 'x')`, [member]),
  );
  check("notifications: cannot call notify_user", await denied(`select public.notify_user($1, 'x', 'x', 'x', '/', null)`, [admin]));
  check(
    "follow-ups: the assignee can complete it",
    (await affected(`update public.follow_ups set status = 'completed' where id = $1`, [followUp])) === 1,
  );
  const [{ completed_at }] = await rows(`select completed_at from public.follow_ups where id = $1`, [followUp]);
  check("follow-ups: completion date is stamped", completed_at !== null);
  check(
    "follow-ups: once closed, the person is hidden from the assignee again",
    (await count(`select 1 from public.people where id = $1`, [outsider])) === 0,
  );
});
await as(admin, async () => {
  check("notifications: other users' are invisible", (await count(`select 1 from public.notifications where user_id = $1`, [member])) === 0);
});
await as(leader, async () => {
  check(
    "follow-ups: leader can create one for a group member",
    (await affected(`insert into public.follow_ups (person_id, follow_up_type) values ($1, 'prayer')`, [inGroup])) === 1,
  );
  check(
    "follow-ups: leader cannot create one for someone outside the group",
    await denied(`insert into public.follow_ups (person_id, follow_up_type) values ($1, 'prayer')`, [outsider]),
  );
  check("follow-ups: leader sees only their group's", (await count(`select 1 from public.follow_up_details`)) === 1);
});

// --- absence threshold ---------------------------------------------------------

const [{ id: sunday2 }] = await rows(
  `insert into public.attendance_sessions (attendance_type_id, title, session_date)
   values ($1, 'Sunday Service', current_date) returning id`,
  [sundayType],
);
await as(admin, async () => {
  await db.query(`insert into public.attendance_records (session_id, person_id, status_id) values ($1, $2, $3)`, [sunday2, inGroup, absent]);
  const created = await rows(
    `select assigned_to, source from public.follow_ups where person_id = $1 and follow_up_type = 'absentee_follow_up'`,
    [inGroup],
  );
  check("absence: second consecutive absence opens a follow-up", created.length === 1 && created[0].source === "absentee");
  check("absence: it is assigned to the cell leader", created[0]?.assigned_to === leader);
  await db.query(`update public.attendance_records set status_id = $1 where session_id = $2 and person_id = $3`, [absent, sunday2, inGroup]);
  check(
    "absence: no duplicate while one is open",
    (await count(`select 1 from public.follow_ups where person_id = $1 and follow_up_type = 'absentee_follow_up'`, [inGroup])) === 1,
  );
});

// --- discipleship history -------------------------------------------------------

await as(pastor, async () => {
  await db.query(`select public.set_discipleship($1, $2, null, 'Started')`, [outsider, stage1]);
  await db.query(`select public.set_discipleship($1, $2, $3, 'Advanced')`, [outsider, stage2, leaderPerson]);
  const history = await rows(
    `select stage_id, completed_at, notes from public.discipleship_records where person_id = $1 order by created_at`,
    [outsider],
  );
  check("discipleship: advancing keeps the previous stage", history.length === 2 && history[0].completed_at !== null && history[1].completed_at === null);
  check("discipleship: notes stay with their stage", history[0]?.notes === "Started" && history[1]?.notes === "Advanced");
  const [p] = await rows(`select discipleship_stage_id, mentor_id from public.people where id = $1`, [outsider]);
  check("discipleship: current stage and mentor are updated", p.discipleship_stage_id === stage2 && p.mentor_id === leaderPerson);
  check(
    "discipleship: mentor history is recorded",
    (await count(`select 1 from public.mentor_relationships where disciple_id = $1 and ended_at is null`, [outsider])) === 1,
  );
  check(
    "discipleship: history cannot be inserted directly",
    await denied(`insert into public.discipleship_records (person_id, stage_id) values ($1, $2)`, [inGroup, stage1]),
  );
});
await as(leader, async () => {
  check("discipleship: a mentor sees their disciple", (await count(`select 1 from public.people where id = $1`, [outsider])) === 1);
  check("discipleship: a mentor sees the disciple's history", (await count(`select 1 from public.discipleship_records where person_id = $1`, [outsider])) === 2);
  await db.query(`select public.set_discipleship($1, $2, null, null)`, [inGroup, stage1]);
  check(
    "discipleship: leader can update someone they lead",
    (await count(`select 1 from public.discipleship_records where person_id = $1`, [inGroup])) === 1,
  );
});
await as(member, async () => {
  check("discipleship: members cannot change stages", await denied(`select public.set_discipleship($1, $2, null, null)`, [memberPerson, stage2]));
});

// --- events ----------------------------------------------------------------------

let eventId;
await as(pastor, async () => {
  eventId = (await rows(
    `insert into public.events (name, event_date) values ('Anniversary', current_date + 1) returning id`,
  ))[0].id;
  const [{ id: eventSession }] = await rows(
    `insert into public.attendance_sessions (attendance_type_id, title, session_date, event_id)
     select id, 'Anniversary', current_date + 1, $1 from public.attendance_types where name = 'Special Event' returning id`,
    [eventId],
  );
  check("events: manager can open the event's attendance", Boolean(eventSession));
  const [{ x }] = await rows(`select public.dashboard_extras() as x`);
  check("events: dashboard counts upcoming events", x.upcoming_events === 1, JSON.stringify(x));
});
await as(member, async () => {
  check("events: members can see events", (await count(`select 1 from public.events`)) === 1);
  check("events: members cannot create events", await denied(`insert into public.events (name, event_date) values ('x', current_date)`));
  check("events: members cannot cancel events", (await affected(`update public.events set status = 'cancelled' where id = $1`, [eventId])) === 0);
  const [{ x }] = await rows(`select public.dashboard_extras() as x`);
  check("dashboard: follow-up counts are scoped to the viewer", x.pending_follow_ups === 0, JSON.stringify(x));
});
// ("nobody" was given the Member role by the user admin earlier on.)
const stranger = await makeUser("stranger@test.local", null);
await as(stranger, async () => {
  check("events: users without a role see none", (await count(`select 1 from public.event_directory`)) === 0);
});

// --- cell groups managed by their leader -------------------------------------------

await as(leader, async () => {
  check(
    "groups: leader can update their group's meeting details",
    (await affected(`update public.cell_groups set location = 'Matina' where id = $1`, [group])) === 1,
  );
  check("groups: leader cannot rename their group", await denied(`update public.cell_groups set name = 'Mine' where id = $1`, [group]));
  check(
    "groups: leader cannot touch another group",
    (await affected(`update public.cell_groups set location = 'x' where id = $1`, [otherGroup])) === 0,
  );
  check(
    "groups: leader can end a membership in their group",
    (await affected(`update public.cell_group_members set left_at = current_date where cell_group_id = $1 and person_id = $2`, [group, memberPerson])) === 1,
  );
  const [{ s }] = await rows(`select public.cell_group_stats($1) as s`, [group]);
  check("groups: statistics reflect the change", s.total_members === 1, JSON.stringify(s));
});

// --- payment methods, accounts, transfers ---------------------------------------------

await db.exec(`
  insert into public.roles (key, name) values ('finance_viewer', 'Finance Viewer');
  insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id from public.roles r join public.permissions p on p.key = 'finance.view'
  where r.key = 'finance_viewer';
`);
const financeViewer = await makeUser("finviewer@test.local", "finance_viewer");
let gcashAccount, cashAccount;
await as(admin, async () => {
  cashAccount = (await rows(`select id from public.financial_accounts where name = 'Church Cash'`))[0].id;
  gcashAccount = (await rows(
    `insert into public.financial_accounts (name, account_type, provider, account_number)
     values ('Test GCash', 'e_wallet', 'GCash', '0917 555 1234') returning id`,
  ))[0].id;
  const [{ id: gcashMethod }] = await rows(`select id from public.payment_methods where name = 'GCash'`);
  const givingBefore = Number((await rows(`select public.finance_stats() as s`))[0].s.total_giving);
  await db.query(
    `insert into public.giving_records (giving_date, category_id, amount, payment_method_id, financial_account_id)
     select current_date, id, 1000, $1, $2 from public.giving_categories order by sort_order limit 1`,
    [gcashMethod, gcashAccount],
  );
  await db.query(
    `insert into public.expenses (expense_date, category_id, description, amount, financial_account_id)
     select current_date, id, 'Load', 300, $1 from public.expense_categories order by sort_order limit 1`,
    [gcashAccount],
  );
  await db.query(
    `insert into public.account_transfers (from_account_id, to_account_id, amount, transfer_date) values ($1, $2, 200, current_date)`,
    [gcashAccount, cashAccount],
  );
  const statement = await rows(`select * from public.account_statement()`);
  const gcash = statement.find((r) => r.account_id === gcashAccount);
  const cash = statement.find((r) => r.account_id === cashAccount);
  check("accounts: balance = giving - expenses - transfers out", Number(gcash?.closing_balance) === 500, JSON.stringify(gcash));
  check("accounts: a transfer arrives in the other account", Number(cash?.closing_balance) === 200, JSON.stringify(cash));
  const givingAfter = Number((await rows(`select public.finance_stats() as s`))[0].s.total_giving);
  check("accounts: a transfer is not counted as giving", givingAfter === givingBefore + 1000, `${givingBefore} -> ${givingAfter}`);
  const [byMethod] = await rows(`select * from public.giving_by_payment_method() where method_name = 'GCash'`);
  check("accounts: giving is grouped by payment method", Number(byMethod?.amount) === 1000);
  const [full] = await rows(`select account_number, account_number_masked from public.financial_account_directory where id = $1`, [gcashAccount]);
  check("accounts: finance managers see the full number", full?.account_number === "0917 555 1234");
  check("accounts: e-wallet numbers are masked as 0917 *** 1234", full?.account_number_masked === "0917 *** 1234", full?.account_number_masked);
  check(
    "accounts: a transfer to the same account is rejected",
    await denied(`insert into public.account_transfers (from_account_id, to_account_id, amount, transfer_date) values ($1, $1, 5, current_date)`, [cashAccount]),
  );
  check(
    "accounts: the audit log names the account but not its number",
    (await count(`select 1 from public.activity_logs where description like '%Test GCash%'`)) === 1 &&
      (await count(`select 1 from public.activity_logs where description like '%0917%'`)) === 0,
  );
});
await as(financeViewer, async () => {
  const [seen] = await rows(`select account_number, account_number_masked from public.financial_account_directory where id = $1`, [gcashAccount]);
  check("accounts: finance viewers get the masked number only", seen?.account_number === null && seen?.account_number_masked === "0917 *** 1234");
  check("accounts: finance viewers cannot read the accounts table", (await count(`select 1 from public.financial_accounts`)) === 0);
  check("accounts: finance viewers can see balances", (await count(`select 1 from public.account_statement()`)) === 2);
  check(
    "accounts: finance viewers cannot record a transfer",
    await denied(`insert into public.account_transfers (from_account_id, to_account_id, amount, transfer_date) values ($1, $2, 5, current_date)`, [cashAccount, gcashAccount]),
  );
  check("accounts: finance viewers cannot add an account", await denied(`insert into public.financial_accounts (name) values ('Sneaky')`));
});
for (const [label, user] of [["pastor", pastor], ["cell leader", leader], ["member", member]]) {
  await as(user, async () => {
    check(`accounts: ${label} sees no accounts`, (await count(`select 1 from public.financial_account_directory`)) === 0);
    check(`accounts: ${label} sees no balances`, (await count(`select 1 from public.account_statement()`)) === 0);
    check(`accounts: ${label} sees no transfers`, (await count(`select 1 from public.account_transfer_details`)) === 0);
    check(`accounts: ${label} sees no payment methods`, (await count(`select 1 from public.payment_methods`)) === 0);
  });
}
await as(null, async () => {
  check("accounts: anon cannot read the account directory", await denied(`select 1 from public.financial_account_directory`));
});
await db.exec(`insert into storage.objects (bucket_id, name) values ('payment-proofs', 'receipt.png')`);
await as(pastor, async () => {
  check("proofs: a pastor cannot see payment proofs", (await count(`select 1 from storage.objects where bucket_id = 'payment-proofs'`)) === 0);
});
await as(financeViewer, async () => {
  check("proofs: finance viewers can see payment proofs", (await count(`select 1 from storage.objects where bucket_id = 'payment-proofs'`)) === 1);
  check("proofs: finance viewers cannot upload", await denied(`insert into storage.objects (bucket_id, name) values ('payment-proofs', 'x.png')`));
});

// --- self sign-up and approval ----------------------------------------------------------

const signup = async (email, meta) =>
  (await rows(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify(meta)]))[0].id;
const applicant = await signup("juan@test.local", {
  signup: "self", first_name: "Juan", last_name: "Dela Cruz", mobile_number: "0900 555 0000",
  is_existing_member: "true", member_hint: "Grace cell group",
  // Things a browser might try to slip in. None of them are read.
  approval_status: "approved", account_status: "active", registration_source: "admin_created", role: "super_admin",
});
const [pendingProfile] = await rows(`select * from public.profiles where id = $1`, [applicant]);
check(
  "signup: a new account is pending whatever it sends",
  pendingProfile.approval_status === "pending" && pendingProfile.account_status === "pending" && pendingProfile.is_active === false && pendingProfile.registration_source === "self_signup",
  JSON.stringify(pendingProfile).slice(0, 160),
);
check("signup: applicant details are stored", pendingProfile.first_name === "Juan" && pendingProfile.is_existing_member === true && pendingProfile.member_hint === "Grace cell group");
check("signup: no role is given", (await count(`select 1 from public.user_roles where user_id = $1`, [applicant])) === 0);
check("signup: user managers are notified", (await count(`select 1 from public.notifications where dedupe_key = $1 and user_id = $2`, [`registration:${applicant}`, admin])) === 1);

await as(applicant, async () => {
  check("pending: sees no people", (await count(`select 1 from public.people`)) === 0);
  check("pending: sees no settings", (await count(`select 1 from public.church_settings`)) === 0);
  check("pending: sees no events", (await count(`select 1 from public.events`)) === 0);
  check("pending: sees no finance", (await count(`select 1 from public.giving_records`)) === 0);
  const [{ a }] = await rows(`select public.get_my_access() as a`);
  check("pending: access payload says pending, with no permissions", a.profile.approval_status === "pending" && a.permissions.length === 0);
  check("pending: cannot approve itself by editing the profile", await denied(`update public.profiles set approval_status = 'approved', account_status = 'active' where id = $1`, [applicant]));
  check("pending: cannot flip is_active", await denied(`update public.profiles set is_active = true where id = $1`, [applicant]));
  check("pending: cannot call the approval function", await denied(`select public.approve_registration($1, $2)`, [applicant, memberRole]));
  check("pending: cannot give itself a role", await denied(`insert into public.user_roles (user_id, role_id) values ($1, $2)`, [applicant, memberRole]));
});

const [{ id: pastorRole }] = await rows(`select id from public.roles where key = 'pastor'`);
const [{ id: superRole }] = await rows(`select id from public.roles where key = 'super_admin'`);
const [{ id: financeRole }] = await rows(`select id from public.roles where key = 'finance_viewer'`);
await as(pastor, async () => {
  check("approval: a pastor cannot approve accounts", await denied(`select public.approve_registration($1, $2)`, [applicant, memberRole]));
});
await as(userAdmin, async () => {
  const assignable = (await rows(`select key from public.assignable_roles()`)).map((r) => r.key);
  check(
    "approval: a user manager can offer Member, Cell Leader and Pastor",
    ["member", "cell_leader", "pastor"].every((key) => assignable.includes(key)),
    assignable.join(","),
  );
  check("approval: but not Super Admin or roles with finance access", !assignable.includes("super_admin") && !assignable.includes("finance_viewer"));
  check("approval: cannot approve someone as Super Admin", await denied(`select public.approve_registration($1, $2)`, [applicant, superRole]));
  check("approval: cannot approve someone into a finance role", await denied(`select public.approve_registration($1, $2)`, [applicant, financeRole]));
  check("approval: cannot hand out a finance role directly either", await denied(`insert into public.user_roles (user_id, role_id) values ($1, $2)`, [nobody, financeRole]));
  check("approval: linking to a member who already has a login is refused", await denied(`select public.approve_registration($1, $2, 'link', $3)`, [applicant, memberRole, memberPerson]));
  await db.query(`select public.approve_registration($1, $2, 'link', $3)`, [applicant, memberRole, outsider]);
});
const [approved] = await rows(`select * from public.profiles where id = $1`, [applicant]);
check("approval: the account becomes approved and active", approved.approval_status === "approved" && approved.account_status === "active" && approved.is_active === true && approved.approved_by === userAdmin);
check("approval: the login is linked to the chosen member, not a new one", (await rows(`select user_id from public.people where id = $1`, [outsider]))[0].user_id === applicant);
check("approval: no duplicate member was created", (await count(`select 1 from public.people where first_name = 'Juan'`)) === 0);
check("approval: it is logged", (await count(`select 1 from public.activity_logs where description like 'Account approved: juan@test.local%'`)) === 1);
check("approval: the linking is logged", (await count(`select 1 from public.activity_logs where description like 'Member linked to account:%'`)) === 1);
check("approval: the applicant is notified", (await count(`select 1 from public.notifications where user_id = $1 and title = 'Your account was approved'`, [applicant])) === 1);
await as(applicant, async () => {
  const [{ a }] = await rows(`select public.get_my_access() as a`);
  check("approved: gets Member permissions only", JSON.stringify(a.permissions) === JSON.stringify(["events.view"]), JSON.stringify(a.permissions));
  check("approved: still sees no finance or care", (await count(`select 1 from public.giving_records`)) === 0 && (await count(`select 1 from public.pastoral_care_records`)) === 0);
});

const second = await signup("maria@test.local", { signup: "self", first_name: "Maria", last_name: "Santos" });
await as(admin, async () => {
  await db.query(`select public.reject_registration($1, 'Unable to verify church membership.')`, [second]);
});
const [rejected] = await rows(`select * from public.profiles where id = $1`, [second]);
check("rejection: status, who and why are stored", rejected.approval_status === "rejected" && rejected.is_active === false && rejected.rejected_by === admin && rejected.rejection_reason === "Unable to verify church membership.");
check("rejection: the reason is not copied into the activity log", (await count(`select 1 from public.activity_logs where description ilike '%Unable to verify%'`)) === 0);
await as(second, async () => {
  check("rejected: sees no people", (await count(`select 1 from public.people`)) === 0);
  check("rejected: cannot re-open its own registration", await denied(`update public.profiles set approval_status = 'pending' where id = $1`, [second]));
});

const third = await signup("pedro@test.local", { signup: "self", first_name: "Pedro", last_name: "Reyes", mobile_number: "0900 555 0001" });
await as(admin, async () => {
  await db.query(`select public.approve_registration($1, $2, 'create')`, [third, pastorRole]);
});
const [created] = await rows(`select person_type, member_code, user_id from public.people where first_name = 'Pedro' and last_name = 'Reyes'`);
check("approval: 'create' makes one new member record linked to the login", created?.user_id === third && created.person_type === "member" && Boolean(created.member_code));

await db.query(`update public.profiles set is_active = false where id = $1`, [third]);
check("status: suspending through is_active sets account_status", (await rows(`select account_status from public.profiles where id = $1`, [third]))[0].account_status === "suspended");
await db.query(`update public.profiles set account_status = 'active' where id = $1`, [third]);
check("status: reactivating through account_status sets is_active", (await rows(`select is_active from public.profiles where id = $1`, [third]))[0].is_active === true);

// --- members and user accounts ---------------------------------------------------------

const visitorForLink = (await rows(`insert into public.people (person_type, first_name, last_name) values ('visitor', 'Vera', 'Visitor') returning id`))[0].id;
const loginA = await makeUser("link-a@test.local", "member");
const loginB = await makeUser("link-b@test.local", "member");
const freeMember = await makePerson("Free", "Member");
await as(pastor, async () => {
  check("accounts: a pastor cannot read the account directory", (await count(`select 1 from public.account_directory()`)) === 0);
  check("accounts: a pastor cannot link an account", await denied(`select public.link_member_account($1, $2)`, [loginA, freeMember]));
});
await as(userAdmin, async () => {
  check("accounts: a visitor cannot be given an account", await denied(`select public.link_member_account($1, $2)`, [loginA, visitorForLink]));
  await db.query(`select public.link_member_account($1, $2)`, [loginA, freeMember]);
  check("accounts: a member cannot get a second account", await denied(`select public.link_member_account($1, $2)`, [loginB, freeMember]));
  check("accounts: an account cannot be linked to a second member", await denied(`select public.link_member_account($1, $2)`, [loginA, memberPerson]));
  const [row] = await rows(`select * from public.account_directory() where user_id = $1`, [loginA]);
  check("accounts: the directory shows the member and the role", row?.person_id === freeMember && row.display_name === "Free Member" && row.role_names.includes("Member"), JSON.stringify(row).slice(0, 200));
});
check("accounts: one login cannot be written onto two members, even by the owner", await denied(`update public.people set user_id = $1 where id = $2`, [loginA, memberPerson]));
check("accounts: the account takes the member's name", (await rows(`select full_name from public.profiles where id = $1`, [loginA]))[0].full_name === "Free Member");
await db.query(`update public.people set first_name = 'Freya' where id = $1`, [freeMember]);
check("accounts: and follows when the member is renamed", (await rows(`select full_name from public.profiles where id = $1`, [loginA]))[0].full_name === "Freya Member");
await db.query(`update auth.users set email = 'freya@test.local' where id = $1`, [loginA]);
const [afterEmail] = await rows(`select pr.email as login, pe.email as contact from public.profiles pr join public.people pe on pe.user_id = pr.id where pr.id = $1`, [loginA]);
check("accounts: a new login email reaches the account, not the member's contact email", afterEmail.login === "freya@test.local" && afterEmail.contact === null, JSON.stringify(afterEmail));

await as(admin, async () => {
  check("archive: a member with an active account cannot be archived on its own", await denied(`update public.people set archived_at = now() where id = $1`, [freeMember]));
});
await as(pastor, async () => {
  check("archive: needs user management to disable the account", await denied(`select public.archive_member_and_disable_account($1)`, [freeMember]));
});
await as(admin, async () => {
  await db.query(`select public.archive_member_and_disable_account($1)`, [freeMember]);
});
const [archivedMember] = await rows(`select pe.archived_at, pe.user_id, pr.is_active, pr.account_status from public.people pe join public.profiles pr on pr.id = pe.user_id where pe.id = $1`, [freeMember]);
check("archive: the member is archived and the account disabled, both kept", archivedMember.archived_at !== null && archivedMember.user_id === loginA && archivedMember.is_active === false && archivedMember.account_status === "disabled");
check("archive: the Auth user is not deleted", (await count(`select 1 from auth.users where id = $1`, [loginA])) === 1);
await as(loginA, async () => {
  check("archive: the disabled account sees nothing", (await count(`select 1 from public.people`)) === 0);
});
await as(userAdmin, async () => {
  check("accounts: an archived member cannot be given an account", await denied(`select public.link_member_account($1, $2)`, [loginB, freeMember]));
});

// --- typography ------------------------------------------------------------------------

const [{ b: publicBranding }] = await rows(`select public.get_public_branding() as b`);
check("typography: defaults reach the public branding", publicBranding.primary_font === "inter" && publicBranding.base_font_size === 16 && publicBranding.heading_font === "same");
await as(pastor, async () => {
  check("typography: a pastor cannot change it", (await affected(`update public.system_appearance_settings set primary_font = 'poppins'`)) === 0);
});
await as(admin, async () => {
  check("typography: unknown fonts are refused", await denied(`update public.system_appearance_settings set primary_font = 'Comic Sans'`));
  check("typography: a font URL is refused", await denied(`update public.system_appearance_settings set heading_font = 'https://example.com/font.woff2'`));
  check("typography: a base size that is too small is refused", await denied(`update public.system_appearance_settings set base_font_size = 10`));
  check("typography: a base size that is too large is refused", await denied(`update public.system_appearance_settings set base_font_size = 40`));
  check("typography: captions cannot go below 11px", await denied(`update public.system_appearance_settings set caption_font_size = 8`));
  const logsBefore = await count(`select 1 from public.activity_logs where module = 'appearance'`);
  await db.query(`update public.system_appearance_settings set primary_font = 'poppins', heading_font = 'montserrat', mobile_font_scale = 'comfortable'`);
  check("typography: saving writes one 'Updated system typography' entry", (await count(`select 1 from public.activity_logs where description = 'Updated system typography' and user_id = $1`, [admin])) === 1);
  check("typography: and no branding entry when only typography changed", (await count(`select 1 from public.activity_logs where module = 'appearance'`)) === logsBefore + 1);
  await db.query(`update public.system_appearance_settings set updated_by = $1`, [admin]);
  check("typography: saving without changes logs nothing", (await count(`select 1 from public.activity_logs where module = 'appearance'`)) === logsBefore + 1);
});
check("typography: the saved fonts reach the public branding", (await rows(`select public.get_public_branding() as b`))[0].b.heading_font === "montserrat");

// --- login page content -----------------------------------------------------------------

const [{ b: loginDefaults }] = await rows(`select public.get_public_branding() as b`);
check(
  "login content: defaults reach the public branding",
  loginDefaults.login_welcome_message.startsWith("Connecting people.") && loginDefaults.login_bible_verse_reference === "Hebrews 10:24" && loginDefaults.show_login_bible_verse === true,
);
await as(pastor, async () => {
  check("login content: a pastor cannot change it", (await affected(`update public.system_appearance_settings set login_welcome_message = 'Hi'`)) === 0);
});
await as(admin, async () => {
  check("login content: a message over 200 characters is refused", await denied(`update public.system_appearance_settings set login_welcome_message = repeat('x', 201)`));
  check("login content: a verse over 300 characters is refused", await denied(`update public.system_appearance_settings set login_bible_verse = repeat('x', 301)`));
  const logsBefore = await count(`select 1 from public.activity_logs where module = 'appearance'`);
  await db.query(`update public.system_appearance_settings set login_welcome_message = 'Welcome home.', show_login_bible_verse = false`);
  check("login content: saving writes one 'Updated login page content' entry", (await count(`select 1 from public.activity_logs where description = 'Updated login page content' and user_id = $1`, [admin])) === 1);
  check("login content: and nothing else", (await count(`select 1 from public.activity_logs where module = 'appearance'`)) === logsBefore + 1);
  check("login content: the text is not copied into the log", (await count(`select 1 from public.activity_logs where description ilike '%Welcome home%'`)) === 0);
  await db.query(`update public.system_appearance_settings set login_bible_verse = ''`);
  check("login content: an empty verse is allowed", (await rows(`select login_bible_verse from public.system_appearance_settings`))[0].login_bible_verse === "");
});
const [{ b: loginSaved }] = await rows(`select public.get_public_branding() as b`);
check("login content: saved text and the hidden verse reach the login page", loginSaved.login_welcome_message === "Welcome home." && loginSaved.show_login_bible_verse === false);

// --- rows per page ---------------------------------------------------------------------

check("paging: the default is 20 rows", (await rows(`select rows_per_page from public.church_settings`))[0].rows_per_page === 20);
await as(pastor, async () => {
  check("paging: a pastor can read the setting", (await rows(`select rows_per_page from public.church_settings`))[0]?.rows_per_page === 20);
  check("paging: but cannot change it", (await affected(`update public.church_settings set rows_per_page = 50`)) === 0);
});
await as(admin, async () => {
  check("paging: an unsupported size is refused", await denied(`update public.church_settings set rows_per_page = 5000`));
  check("paging: an administrator can change it", (await affected(`update public.church_settings set rows_per_page = 50`)) === 1);
});

// --- motion settings -------------------------------------------------------------------

const [{ b: motionDefaults }] = await rows(`select public.get_public_branding() as b`);
check("motion: defaults are on, subtle, with scroll reveal", motionDefaults.animations_enabled === true && motionDefaults.animation_level === "subtle" && motionDefaults.scroll_reveal_enabled === true);
await as(pastor, async () => {
  check("motion: a pastor cannot change it", (await affected(`update public.system_appearance_settings set animation_level = 'normal'`)) === 0);
});
await as(admin, async () => {
  check("motion: an unknown level is refused", await denied(`update public.system_appearance_settings set animation_level = 'extreme'`));
  const logsBefore = await count(`select 1 from public.activity_logs where module = 'appearance'`);
  await db.query(`update public.system_appearance_settings set animation_level = 'normal', scroll_reveal_enabled = false`);
  check("motion: saving writes one motion entry and nothing else", (await count(`select 1 from public.activity_logs where description = 'Updated motion and animation settings'`)) === 1 && (await count(`select 1 from public.activity_logs where module = 'appearance'`)) === logsBefore + 1);
});

// --- system background ------------------------------------------------------------------

const [{ b: backgroundDefaults }] = await rows(`select public.get_public_branding() as b`);
check(
  "background: off by default, with no picture and a readable overlay",
  backgroundDefaults.system_background_enabled === false && backgroundDefaults.system_background_path === null && backgroundDefaults.background_overlay_opacity_light === 75 && backgroundDefaults.card_background_style === "solid",
);
await as(pastor, async () => {
  check("background: a pastor cannot change it", (await affected(`update public.system_appearance_settings set system_background_enabled = true`)) === 0);
});
await as(admin, async () => {
  check("background: an unknown size is refused", await denied(`update public.system_appearance_settings set background_size = 'stretch'`));
  check("background: too much blur is refused", await denied(`update public.system_appearance_settings set background_blur = 40`));
  check("background: a sidebar that is too see-through is refused", await denied(`update public.system_appearance_settings set sidebar_opacity = 20`));
  check("background: an overlay colour must be a HEX colour", await denied(`update public.system_appearance_settings set background_overlay_color_light = 'white'`));
  const logsBefore = await count(`select 1 from public.activity_logs where module = 'appearance'`);
  await db.query(`update public.system_appearance_settings set system_background_path = 'system-background-test.webp', system_background_enabled = true, background_blur = 4`);
  check("background: saving writes one background entry and nothing else", (await count(`select 1 from public.activity_logs where description = 'Updated system background appearance'`)) === 1 && (await count(`select 1 from public.activity_logs where module = 'appearance'`)) === logsBefore + 1);
});
const [{ b: backgroundSaved }] = await rows(`select public.get_public_branding() as b`);
check("background: it is separate from the login background", backgroundSaved.system_background_path === "system-background-test.webp" && backgroundSaved.login_background_path === null);

// --- giving collections (batch entry) ---------------------------------------------------

const [{ id: coll_tithes }] = await rows(`select id from public.giving_categories order by sort_order, name limit 1`);
const [{ id: coll_cashMethod }] = await rows(`select id from public.payment_methods where kind = 'cash' limit 1`);
const [{ id: coll_walletMethod }] = await rows(`select id from public.payment_methods where kind = 'e_wallet' limit 1`);
const [{ id: coll_cashAccount }] = await rows(`insert into public.financial_accounts (name, account_type) values ('Collection Test Cash', 'cash') returning id`);
const givingTotal = async () => Number((await rows(`select coalesce(sum(amount), 0) as t from public.giving_records`))[0].t);
const accountBalance = async () => Number((await rows(`select coalesce(sum(amount), 0) as t from public.giving_records where financial_account_id = $1`, [coll_cashAccount]))[0].t);
const coll_header = JSON.stringify({ collection_name: "Sunday Service - Test", collection_date: "2026-10-18", entry_mode: "summary", notes: "" });
const coll_lines = JSON.stringify([
  { category_id: coll_tithes, payment_method_id: coll_cashMethod, financial_account_id: coll_cashAccount, amount: 15000 },
  { category_id: coll_tithes, payment_method_id: coll_walletMethod, amount: 4000, reference_number: "REF-COLL-1" },
]);
const totalBefore = await givingTotal();

await as(financeViewer, async () => {
  check("collections: a finance viewer cannot create one", await denied(`select public.save_giving_collection(null, $1::jsonb, $2::jsonb)`, [coll_header, coll_lines]));
});
let collectionId;
await as(admin, async () => {
  collectionId = (await rows(`select public.save_giving_collection(null, $1::jsonb, $2::jsonb) as id`, [coll_header, coll_lines]))[0].id;
  check("collections: an entry needs a category and a method", await denied(`select public.save_giving_collection(null, $1::jsonb, $2::jsonb)`, [coll_header, JSON.stringify([{ amount: 100 }])]));
  check("collections: an amount must be more than zero", await denied(`select public.save_giving_collection(null, $1::jsonb, $2::jsonb)`, [coll_header, JSON.stringify([{ category_id: coll_tithes, payment_method_id: coll_cashMethod, amount: 0 }])]));
});
check("collections: a draft adds nothing to giving", (await givingTotal()) === totalBefore);
const [coll_draft] = await rows(`select status, entry_count, total from public.giving_collection_summary where id = $1`, [collectionId]);
check("collections: the draft's total comes from its lines", coll_draft.status === "draft" && coll_draft.entry_count === 2 && Number(coll_draft.total) === 19000, JSON.stringify(coll_draft));

await as(admin, async () => {
  // Saving again replaces the coll_lines instead of adding to them.
  await db.query(`select public.save_giving_collection($1, $2::jsonb, $3::jsonb)`, [collectionId, coll_header, coll_lines]);
});
check("collections: saving a draft again does not duplicate its lines", (await count(`select 1 from public.giving_collection_entries where collection_id = $1`, [collectionId])) === 2);

await as(pastor, async () => {
  check("collections: a pastor cannot see collections", (await count(`select 1 from public.giving_collections`)) === 0);
  check("collections: a pastor cannot post one", await denied(`select public.post_giving_collection($1)`, [collectionId]));
});
await as(financeViewer, async () => {
  check("collections: a finance viewer can see them", (await count(`select 1 from public.giving_collection_summary`)) === 1);
  check("collections: but cannot post", await denied(`select public.post_giving_collection($1)`, [collectionId]));
  check("collections: nor write the tables directly", await denied(`update public.giving_collections set status = 'posted' where id = $1`, [collectionId]));
});
await as(admin, async () => {
  const [{ n }] = await rows(`select public.post_giving_collection($1) as n`, [collectionId]);
  check("collections: posting reports how many entries it made", n === 2);
  check("collections: a posted collection cannot be posted twice", await denied(`select public.post_giving_collection($1)`, [collectionId]));
  check("collections: nor edited", await denied(`select public.save_giving_collection($1, $2::jsonb, $3::jsonb)`, [collectionId, coll_header, coll_lines]));
  check("collections: nor discarded", await denied(`select public.discard_giving_collection($1)`, [collectionId]));
});
check("collections: posting adds exactly the lines, once (no double counting)", (await givingTotal()) === totalBefore + 19000, String(await givingTotal()));
check("collections: the money reaches the chosen account", (await accountBalance()) === 15000);
check("collections: each record is linked to its collection and dated with it", (await count(`select 1 from public.giving_records where collection_id = $1 and giving_date = '2026-10-18'`, [collectionId])) === 2);
check("collections: amounts are not written to the activity log", (await count(`select 1 from public.activity_logs where description like 'Giving collection%' and description ~ '19[,]?000'`)) === 0);
await as(admin, async () => {
  const [record] = await rows(`select id from public.giving_records where collection_id = $1 limit 1`, [collectionId]);
  check("collections: a posted entry cannot be edited on its own", await denied(`update public.giving_records set amount = 1 where id = $1`, [record.id]));
  check("collections: nor deleted on its own", await denied(`delete from public.giving_records where id = $1`, [record.id]));
  check("collections: an ordinary record cannot be slipped into a collection", await denied(`insert into public.giving_records (giving_date, category_id, amount, collection_id) values (current_date, $1, 5, $2)`, [coll_tithes, collectionId]));
  const found = await rows(`select * from public.existing_giving_references($1::text[])`, [["ref-coll-1", "NOPE"]]);
  check("collections: an existing reference number is found, whatever its case", found.length === 1 && found[0].collection_name === "Sunday Service - Test");
  check("collections: but not when it is the collection's own", (await count(`select 1 from public.existing_giving_references($1::text[], $2)`, [["REF-COLL-1"], collectionId])) === 0);
  await db.query(`select public.void_giving_collection($1, 'Entered twice')`, [collectionId]);
});
check("collections: voiding takes the money back out", (await givingTotal()) === totalBefore && (await accountBalance()) === 0);
const [coll_voided] = await rows(`select status, void_reason, entry_count, total from public.giving_collection_summary where id = $1`, [collectionId]);
check("collections: the voided collection and its lines are kept as history", coll_voided.status === "voided" && coll_voided.void_reason === "Entered twice" && coll_voided.entry_count === 2 && Number(coll_voided.total) === 19000);
check("collections: created, posted and voided are logged", (await count(`select 1 from public.activity_logs where record_id = $1 and action in ('created', 'posted', 'voided')`, [collectionId])) === 3);
await as(admin, async () => {
  const id = (await rows(`select public.save_giving_collection(null, $1::jsonb, '[]'::jsonb) as id`, [coll_header]))[0].id;
  check("collections: an empty collection cannot be posted", await denied(`select public.post_giving_collection($1)`, [id]));
  await db.query(`select public.discard_giving_collection($1)`, [id]);
  check("collections: a draft can be discarded", (await count(`select 1 from public.giving_collections where id = $1`, [id])) === 0);
});

// --- demo data removal ---------------------------------------------------------------

const demoPerson = await makePerson("Demo", "Person", { is_demo: true, member_code: "DEMO-001" });
await db.query(`insert into public.attendance_records (session_id, person_id, status_id) values ($1, $2, $3)`, [sunday, demoPerson, present]);
await db.query(`insert into public.follow_ups (person_id, follow_up_type, is_demo) values ($1, 'call', true)`, [demoPerson]);
await db.query(`insert into public.giving_records (giving_date, category_id, amount, is_demo)
                select current_date, id, 100, true from public.giving_categories limit 1`);
const realPeopleBefore = await count(`select 1 from public.people where not is_demo`);
const realGivingBefore = await count(`select 1 from public.giving_records where not is_demo`);
await as(pastor, async () => {
  check("demo: a pastor cannot remove demo data", await denied(`select public.remove_demo_data()`));
  const [{ s }] = await rows(`select public.demo_data_summary() as s`);
  check("demo: a pastor cannot see the demo summary", s === null);
});
await as(admin, async () => {
  const [{ s }] = await rows(`select public.demo_data_summary() as s`);
  check("demo: Super Admin sees the summary", s?.members === 1 && s?.giving_records === 1, JSON.stringify(s));
  const [{ r }] = await rows(`select public.remove_demo_data() as r`);
  check("demo: removal reports what it removed", r?.people === 1, JSON.stringify(r));
  check("demo: has_demo_data is false afterwards", (await rows(`select public.has_demo_data() as h`))[0].h === false);
});
check("demo: no demo rows remain", (await count(`select 1 from public.people where is_demo`)) === 0 && (await count(`select 1 from public.giving_records where is_demo`)) === 0);
check("demo: real people are untouched", (await count(`select 1 from public.people where not is_demo`)) === realPeopleBefore);
check("demo: real giving is untouched", (await count(`select 1 from public.giving_records where not is_demo`)) === realGivingBefore);
check(
  "demo: removal leaves one summary log entry",
  (await count(`select 1 from public.activity_logs where description like 'Demo data removed:%'`)) === 1,
);

// --- result -----------------------------------------------------------------

console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const failure of failures) {
  console.log(`  FAIL  ${failure}`);
}
process.exit(failures.length ? 1 : 0);
