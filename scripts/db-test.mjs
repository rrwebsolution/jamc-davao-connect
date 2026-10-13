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
    raw_user_meta_data jsonb not null default '{}'
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
