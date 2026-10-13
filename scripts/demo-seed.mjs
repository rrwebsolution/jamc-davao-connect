// Loads presentation data into the real database: fictional members, visitors,
// cell groups, attendance, follow-ups, care records, discipleship, ministries,
// events and finance. Everything it creates is marked is_demo = true (or hangs
// off a marked row) and can be removed with `npm run demo:remove`.
//
//   npm run demo:seed
//
// Safe to run again: every row has a fixed ID, so a second run adds nothing.
// Dates are relative to the day it first runs; to refresh them, remove and seed again.
// It never deletes or changes existing records. All names and contact details are invented.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // No file: rely on the real environment.
  }
}
loadEnv(".env.local");
if (!process.env.SUPABASE_DB_URL) {
  console.error("Set SUPABASE_DB_URL in .env.local first.");
  process.exit(1);
}

// --- helpers ------------------------------------------------------------------

/** A fixed UUID for a demo row, so re-running never duplicates it. */
function id(key) {
  const hex = createHash("md5").update(`jamc-demo:${key}`).digest("hex").split("");
  hex[12] = "4";
  hex[16] = "89ab"[parseInt(hex[16], 16) % 4];
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Repeatable "random" numbers, so the same data comes out on every machine. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(20240601);
const between = (min, max) => Math.round(min + random() * (max - min));
const roundTo = (value, step) => Math.round(value / step) * step;

const toDate = (text) => new Date(`${text}T00:00:00Z`);
const fmt = (date) => date.toISOString().slice(0, 10);
const addDays = (text, days) => fmt(new Date(toDate(text).getTime() + days * 86400000));
const addMonths = (text, months) => {
  const d = toDate(text);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return fmt(d);
};
const weekday = (text) => toDate(text).getUTCDay();

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const counts = {};
/** Multi-row insert that skips rows which already exist. */
async function insert(table, rows, conflict = "(id)") {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  let added = 0;
  for (let start = 0; start < rows.length; start += 200) {
    const chunk = rows.slice(start, start + 200);
    const values = [];
    const tuples = chunk.map((row, r) => {
      columns.forEach((column) => values.push(row[column]));
      return `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(", ")})`;
    });
    const result = await client.query(
      `insert into public.${table} (${columns.join(", ")}) values ${tuples.join(", ")} on conflict ${conflict} do nothing`,
      values,
    );
    added += result.rowCount ?? 0;
  }
  counts[table] = (counts[table] ?? 0) + added;
}
const all = async (sql, params = []) => (await client.query(sql, params)).rows;

try {
  await client.query("begin");

  // --- what already exists (never changed) --------------------------------------
  const [{ today }] = await all(`select public.church_today()::text as today`);
  const [admin] = await all(
    `select ur.user_id from public.user_roles ur join public.roles r on r.id = ur.role_id
     join public.profiles p on p.id = ur.user_id where r.key = 'super_admin' and p.is_active
     order by ur.assigned_at limit 1`,
  );
  const adminId = admin?.user_id ?? null;

  const stages = await all(`select id, name from public.discipleship_stages where is_active order by sort_order`);
  const membershipStatuses = await all(`select id, name, is_default from public.membership_statuses where is_active order by sort_order`);
  const baptismStatuses = await all(`select id, name from public.baptism_statuses where is_active order by sort_order`);
  const types = await all(`select id, name, counts_for_absence from public.attendance_types where is_active order by sort_order`);
  const statuses = await all(`select id, name, counts_as_present from public.attendance_statuses where is_active order by sort_order`);
  if (stages.length === 0 || types.length === 0 || statuses.length === 0) {
    throw new Error("The configuration lists (stages, attendance types and statuses) are empty. Run the migrations first.");
  }

  const byName = (list, name, fallback) => list.find((item) => item.name.toLowerCase() === name.toLowerCase()) ?? fallback;
  const sundayType = byName(types, "Sunday Service", types.find((t) => t.counts_for_absence) ?? types[0]);
  const prayerType = byName(types, "Prayer Meeting", types[0]);
  const cellType = byName(types, "Cell Meeting", types[0]);
  const eventType = byName(types, "Special Event", types[0]);
  const PRESENT = byName(statuses, "Present", statuses.find((s) => s.counts_as_present)).id;
  const LATE = byName(statuses, "Late", statuses.find((s) => s.counts_as_present)).id;
  const ABSENT = byName(statuses, "Absent", statuses.find((s) => !s.counts_as_present)).id;
  const EXCUSED = byName(statuses, "Excused", statuses.find((s) => !s.counts_as_present)).id;
  const baptized = byName(baptismStatuses, "Baptized", baptismStatuses.at(-1))?.id ?? null;
  const notBaptized = byName(baptismStatuses, "Not Baptized", baptismStatuses[0])?.id ?? null;
  const regular = byName(membershipStatuses, "Regular Member", membershipStatuses.find((s) => s.is_default) ?? membershipStatuses[0])?.id ?? null;
  const newMember = byName(membershipStatuses, "New Member", null)?.id ?? regular;
  const inactiveStatus = byName(membershipStatuses, "Inactive", null)?.id ?? regular;
  const stage = (index) => stages[Math.min(index, stages.length - 1)].id;

  // --- members --------------------------------------------------------------------
  // [first, last, gender, age, civil, group (0-4, null = none), stage index,
  //  baptized, months since joining, attendance profile, birthday]
  // Birthday: "this" = later this month, "next" = next month, otherwise a fixed month.
  const M = [
    ["Rafael", "Dimaculangan", "male", 46, "married", 0, 8, true, 62, "steady", 3],
    ["Maricel", "Dimaculangan", "female", 44, "married", 0, 7, true, 62, "steady", "this"],
    ["Jonel", "Bautista", "male", 31, "single", 0, 5, true, 30, "steady", 7],
    ["Kristine", "Salvador", "female", 27, "single", 0, 4, true, 18, "regular", "next"],
    ["Aldrin", "Pangilinan", "male", 23, "single", 0, 3, false, 7, "regular", 11],
    ["Lorna", "Macaraeg", "female", 58, "widowed", 0, 5, true, 48, "steady", "this"],
    ["Benjie", "Tolentino", "male", 35, "married", 0, 2, false, 4, "lapsed", 1],
    ["Sheila", "Tolentino", "female", 33, "married", 0, 3, true, 4, "regular", 5],

    ["Ernesto", "Villanueva", "male", 52, "married", 1, 7, true, 55, "steady", "next"],
    ["Corazon", "Villanueva", "female", 50, "married", 1, 6, true, 55, "steady", 9],
    ["Paolo", "Evangelista", "male", 29, "single", 1, 5, true, 26, "regular", "this"],
    ["Jasmine", "Lacson", "female", 24, "single", 1, 4, true, 14, "regular", 2],
    ["Noel", "Abrenica", "male", 41, "married", 1, 3, false, 9, "irregular", 12],
    ["Tess", "Abrenica", "female", 39, "married", 1, 3, true, 9, "regular", "next"],

    ["Dominic", "Sarmiento", "male", 38, "married", 2, 7, true, 40, "steady", 6],
    ["Aileen", "Sarmiento", "female", 36, "married", 2, 6, true, 40, "steady", "this"],
    ["Carlo", "Magbanua", "male", 26, "single", 2, 4, true, 12, "regular", 8],
    ["Rhea", "Fontanilla", "female", 22, "single", 2, 2, false, 5, "lapsed", 10],
    ["Gilbert", "Ocampo", "male", 47, "separated", 2, 3, true, 20, "irregular", "next"],

    ["Marivic", "Lumanog", "female", 43, "married", 3, 7, true, 36, "steady", 4],
    ["Jun", "Lumanog", "male", 45, "married", 3, 5, true, 36, "regular", 1],
    ["Hannah", "Reyes", "female", 20, "single", 3, 3, false, 6, "regular", "this"],
    ["Marlon", "Quiambao", "male", 28, "single", 3, 2, false, 3, "lapsed", 7],

    ["Arnel", "Buenaventura", "male", 40, "married", 4, 7, true, 28, "steady", "next"],
    ["Liza", "Buenaventura", "female", 37, "married", 4, 5, true, 28, "regular", 3],
    ["Nico", "Alcantara", "male", 19, "single", 4, 1, false, 2, "regular", 9],

    ["Felisa", "Panganiban", "female", 66, "widowed", null, 5, true, 70, "regular", 12],
    ["Rodel", "Castañeda", "male", 34, "single", null, 1, false, 1, "irregular", 5],
    ["Imelda", "Soriano", "female", 55, "married", null, 4, true, 44, "inactive", 2],
    ["Vincent", "Agustin", "male", 30, "single", null, 2, false, 15, "inactive", 6],
  ];

  const [ty, tm, td] = today.split("-").map(Number);
  let thisMonthSlot = 0;
  let nextMonthSlot = 0;
  function birthdate(age, when) {
    let month;
    let day;
    if (when === "this") {
      // Spread over the rest of this month so the Birthdays page has upcoming ones.
      const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
      month = tm;
      day = Math.min(last, td + [0, 2, 5, 9, 13][thisMonthSlot++ % 5]);
    } else if (when === "next") {
      month = (tm % 12) + 1;
      day = [4, 11, 17, 23, 27][nextMonthSlot++ % 5];
    } else {
      month = when;
      day = between(3, 26);
    }
    const hadBirthday = month < tm || (month === tm && day <= td);
    const year = ty - age - (hadBirthday ? 0 : 1);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const members = M.map(([first, last, gender, age, civil, group, stageIndex, isBaptized, months, profile, bday], i) => {
    const joined = addDays(addMonths(today, -months), -between(0, 20));
    const baptismDay = addDays(joined, between(30, 200));
    return {
      key: i,
      group,
      stageIndex,
      profile,
      months,
      joined,
      row: {
        id: id(`member:${i}`),
        person_type: "member",
        member_code: `DEMO-${String(i + 1).padStart(3, "0")}`,
        first_name: first,
        last_name: last,
        gender,
        birthdate: birthdate(age, bday),
        civil_status: civil,
        contact_number: `0900 555 ${String(1000 + i * 37).slice(-4)}`,
        email: `${first}.${last}`.toLowerCase().normalize("NFD").replace(/[^a-z.]/g, "") + "@demo.jamc.example",
        address: `${between(10, 280)} Sample St., Brgy. Demo, Davao City`,
        date_first_attended: addDays(joined, -between(20, 90)),
        membership_date: joined,
        membership_status_id: profile === "inactive" ? inactiveStatus : months <= 3 ? newMember : regular,
        baptism_status_id: isBaptized ? baptized : notBaptized,
        baptism_date: isBaptized && baptismDay <= today ? baptismDay : null,
        is_active: profile !== "inactive",
        is_demo: true,
      },
    };
  });
  await insert("people", members.map((m) => m.row));
  const memberId = (index) => members[index].row.id;

  // --- visitors -------------------------------------------------------------------
  // [first, last, gender, status, days since first visit, invited by (member index)]
  const V = [
    ["Angelo", "Marasigan", "male", "new", 3, 2],
    ["Bea", "Custodio", "female", "new", 3, 3],
    ["Ramon", "Delgado", "male", "new", 10, null],
    ["Clarisse", "Umali", "female", "contacted", 17, 11],
    ["Jerome", "Batungbakal", "male", "contacted", 24, 16],
    ["Divina", "Mercado", "female", "follow_up_scheduled", 31, 9],
    ["Oscar", "Lagdameo", "male", "follow_up_scheduled", 45, null],
    ["Trisha", "Navarro", "female", "returning", 52, 21],
    ["Efren", "Zamora", "male", "returning", 73, 0],
    ["Joy", "Ilagan", "female", "connected_to_cell_group", 96, 19],
  ];
  const lastSunday = addDays(today, -weekday(today));
  const visitors = V.map(([first, last, gender, status, daysAgo, invitedBy], i) => {
    const visit = addDays(lastSunday, -(Math.floor(daysAgo / 7) * 7));
    return {
      status,
      visit,
      person: {
        id: id(`visitor:${i}`),
        person_type: "visitor",
        first_name: first,
        last_name: last,
        gender,
        contact_number: `0900 555 ${String(7000 + i * 53).slice(-4)}`,
        email: `${first}.${last}`.toLowerCase() + "@demo.jamc.example",
        address: `Brgy. Demo ${i + 1}, Davao City`,
        date_first_attended: visit,
        is_demo: true,
      },
      profile: {
        person_id: id(`visitor:${i}`),
        first_visit_date: visit,
        invited_by_person_id: invitedBy === null ? null : memberId(invitedBy),
        invited_by_name: invitedBy === null ? "Walk-in" : null,
        attendance_type_id: sundayType.id,
        notes: "Demo visitor record.",
        status,
      },
    };
  });
  await insert("people", visitors.map((v) => v.person));
  await insert("visitor_profiles", visitors.map((v) => v.profile), "(person_id)");

  // One member who first came as a visitor ("Became Member").
  await insert(
    "visitor_profiles",
    [{
      person_id: memberId(25),
      first_visit_date: members[25].row.date_first_attended,
      invited_by_person_id: memberId(23),
      invited_by_name: null,
      attendance_type_id: sundayType.id,
      notes: "Demo record: joined after visiting with a friend.",
      status: "became_member",
    }],
    "(person_id)",
  );

  // --- cell groups ------------------------------------------------------------------
  const G = [
    ["Faith", 0, 1, "friday", "19:00", "Dimaculangan residence, Matina"],
    ["Grace", 8, 9, "wednesday", "19:30", "Villanueva residence, Buhangin"],
    ["Hope", 14, 15, "thursday", "19:00", "Church annex, 2nd floor"],
    ["Love", 19, 20, "saturday", "16:00", "Lumanog residence, Toril"],
    ["Victory", 23, 24, "tuesday", "19:00", "Buenaventura residence, Lanang"],
  ];
  const groups = G.map(([name, leader, assistant, day, time, location], i) => ({
    id: id(`group:${i}`),
    // "(Demo)" keeps the name from colliding with a real group of the same name.
    name: `${name} (Demo)`,
    leader_id: memberId(leader),
    assistant_leader_id: memberId(assistant),
    meeting_day: day,
    meeting_time: time,
    location,
    description: `Demo cell group for presentation.`,
    is_demo: true,
  }));
  await insert("cell_groups", groups);
  await insert(
    "cell_group_members",
    members
      .filter((m) => m.group !== null)
      .map((m) => ({
        id: id(`group-member:${m.key}`),
        cell_group_id: groups[m.group].id,
        person_id: m.row.id,
        joined_at: m.joined,
      })),
  );

  // --- discipleship: history first, then the current stage --------------------------
  // Each member walked the path up to their current stage, one stage every few months.
  const history = [];
  for (const m of members) {
    const steps = Math.min(m.stageIndex, stages.length - 1) + 1;
    const span = Math.max(1, Math.floor((m.months * 30) / steps));
    for (let s = 0; s < steps; s += 1) {
      const started = addDays(m.joined, s * span);
      const isCurrent = s === steps - 1;
      history.push({
        id: id(`stage:${m.key}:${s}`),
        person_id: m.row.id,
        stage_id: stage(s),
        started_at: started > today ? today : started,
        completed_at: isCurrent ? null : addDays(m.joined, (s + 1) * span) > today ? today : addDays(m.joined, (s + 1) * span),
        notes: isCurrent ? null : "Completed (demo history).",
      });
    }
  }
  await insert("discipleship_records", history);

  // Mentors: group leaders mentor two people in their group; a senior couple mentors leaders.
  const mentorOf = { 2: 0, 3: 1, 4: 0, 10: 8, 11: 9, 12: 8, 16: 14, 17: 15, 21: 19, 22: 20, 25: 23, 8: 0, 14: 0, 19: 1, 23: 0 };
  for (const m of members) {
    await client.query(
      `update public.people set discipleship_stage_id = $2, mentor_id = $3
       where id = $1 and is_demo and (discipleship_stage_id is null or discipleship_stage_id = $2)`,
      [m.row.id, stage(m.stageIndex), mentorOf[m.key] === undefined ? null : memberId(mentorOf[m.key])],
    );
  }
  // The trigger starts mentoring "today"; move it back so it reads as an existing relationship.
  await client.query(
    `update public.mentor_relationships r set started_at = least(started_at, greatest(p.membership_date + 30, current_date - 400))
     from public.people p where p.id = r.disciple_id and p.is_demo and r.ended_at is null`,
  );

  await insert("discipleship_milestones", [
    [2, "Completed Foundations class", -210], [2, "Started serving in the Worship team", -120],
    [3, "Water baptism", -300], [10, "Led a cell meeting for the first time", -45],
    [16, "Completed Foundations class", -160], [21, "Water baptism", -95], [25, "Joined a cell group", -40],
  ].map(([member, title, days], i) => ({
    id: id(`milestone:${i}`), person_id: memberId(member), title, achieved_on: addDays(today, days), is_demo: true,
  })));

  await insert("apprentices", [
    [2, 0, "cell_leader", "ready", "Leads worship in the group; ready to host."],
    [10, 1, "cell_leader", "active", "Assisting with follow-ups."],
    [16, 2, "mentor", "active", "Meeting two younger members."],
  ].map(([member, group, track, status, notes], i) => ({
    id: id(`apprentice:${i}`), person_id: memberId(member), cell_group_id: groups[group].id, track, status, notes,
    started_at: addDays(today, -between(40, 150)), is_demo: true,
  })), "(person_id, track)");

  // --- ministries (existing ones are used; leaders are only filled in when empty) ----
  const ministries = await all(`select id, name, leader_id, assistant_leader_id from public.ministries where archived_at is null`);
  const ministry = (name) => ministries.find((item) => item.name.toLowerCase() === name.toLowerCase());
  // [ministry, member, role]; the first two listed for a ministry are its leader and assistant.
  const A = [
    ["Worship", 2, "Worship leader"], ["Worship", 3, "Vocalist"], ["Worship", 11, "Keyboard"], ["Worship", 16, "Guitar"],
    ["Media", 10, "Team lead"], ["Media", 4, "Slides"], ["Media", 25, "Camera"],
    ["Ushers", 20, "Head usher"], ["Ushers", 12, "Usher"], ["Ushers", 6, "Usher"], ["Ushers", 18, "Usher"],
    ["Kids Ministry", 15, "Coordinator"], ["Kids Ministry", 13, "Teacher"], ["Kids Ministry", 7, "Teacher"], ["Kids Ministry", 24, "Assistant"],
    ["Youth", 16, "Youth leader"], ["Youth", 21, "Assistant"], ["Youth", 4, "Member"], ["Youth", 25, "Member"],
    ["Prayer Team", 5, "Coordinator"], ["Prayer Team", 26, "Intercessor"], ["Prayer Team", 9, "Intercessor"], ["Prayer Team", 1, "Intercessor"],
    ["Administration", 1, "Secretary"], ["Administration", 19, "Treasurer"],
  ];
  const seenMinistry = {};
  const assignments = [];
  for (const [name, member, role] of A) {
    const target = ministry(name);
    if (!target) continue;
    const position = (seenMinistry[name] = (seenMinistry[name] ?? 0) + 1);
    if (position === 1 && !target.leader_id) {
      await client.query(`update public.ministries set leader_id = $2 where id = $1 and leader_id is null`, [target.id, memberId(member)]);
    }
    if (position === 2 && !target.assistant_leader_id) {
      await client.query(`update public.ministries set assistant_leader_id = $2 where id = $1 and assistant_leader_id is null`, [target.id, memberId(member)]);
    }
    assignments.push({
      id: id(`ministry:${name}:${member}`), ministry_id: target.id, person_id: memberId(member), role,
      date_assigned: addDays(today, -between(30, 400)), status: "active",
    });
  }
  await insert("ministry_members", assignments, "(ministry_id, person_id)");

  // --- attendance ---------------------------------------------------------------------
  // Created with the absence trigger switched off, so that history loads quietly and the
  // absentee follow-ups below are created deliberately rather than once per past absence.
  await client.query(`alter table public.attendance_records disable trigger attendance_records_absence`);

  const WEEKS = 12;
  const chance = { steady: 0.95, regular: 0.82, irregular: 0.55, lapsed: 0.85, inactive: 0 };
  const sessions = [];
  const records = [];
  const mark = (sessionId, personId, statusId) =>
    records.push({ id: id(`record:${sessionId}:${personId}`), session_id: sessionId, person_id: personId, status_id: statusId });

  for (let week = WEEKS - 1; week >= 0; week -= 1) {
    const sunday = addDays(lastSunday, -7 * week);
    const sundayId = id(`session:sunday:${week}`);
    sessions.push({ id: sundayId, attendance_type_id: sundayType.id, title: sundayType.name, session_date: sunday, cell_group_id: null, is_demo: true });
    for (const m of members) {
      if (m.profile === "inactive" || m.joined > sunday) continue;
      // "Lapsed" members came regularly, then stopped three Sundays ago.
      let present = random() < chance[m.profile];
      if (m.profile === "lapsed" && week <= 2) present = false;
      const roll = random();
      mark(sundayId, m.row.id, present ? (roll < 0.1 ? LATE : PRESENT) : roll < 0.25 ? EXCUSED : ABSENT);
    }
    for (const v of visitors) {
      const returning = ["returning", "connected_to_cell_group"].includes(v.status) && sunday > v.visit && random() < 0.6;
      if (v.visit === sunday || returning) mark(sundayId, v.person.id, PRESENT);
    }

    // Midweek prayer meeting: a smaller, more committed crowd.
    const prayerDay = addDays(sunday, 3);
    if (prayerDay <= today) {
      const prayerId = id(`session:prayer:${week}`);
      sessions.push({ id: prayerId, attendance_type_id: prayerType.id, title: prayerType.name, session_date: prayerDay, cell_group_id: null, is_demo: true });
      for (const m of members) {
        if (m.profile === "inactive" || m.profile === "lapsed" || m.joined > prayerDay) continue;
        if (random() < (m.profile === "steady" ? 0.75 : 0.3)) mark(prayerId, m.row.id, random() < 0.12 ? LATE : PRESENT);
      }
    }

    // Cell meetings on each group's own day, for the last eight weeks.
    if (week < 8) {
      const days = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
      groups.forEach((group, g) => {
        const date = addDays(sunday, days[group.meeting_day]);
        if (date > today) return;
        const sessionId = id(`session:cell:${g}:${week}`);
        sessions.push({ id: sessionId, attendance_type_id: cellType.id, title: `${group.name} cell meeting`, session_date: date, cell_group_id: group.id, is_demo: true });
        for (const m of members.filter((item) => item.group === g && item.joined <= date)) {
          const present = m.profile === "lapsed" && week <= 2 ? false : random() < chance[m.profile] - 0.08;
          mark(sessionId, m.row.id, present ? PRESENT : random() < 0.4 ? EXCUSED : ABSENT);
        }
      });
    }
  }
  await insert("attendance_sessions", sessions);
  await insert("attendance_records", records, "(session_id, person_id)");
  await client.query(`alter table public.attendance_records enable trigger attendance_records_absence`);

  // --- follow-ups ---------------------------------------------------------------------
  const [{ threshold }] = await all(`select absence_threshold as threshold from public.church_settings limit 1`);
  // Demo members have no logins, so everything is assigned to the Super Admin.
  const F = [
    // [person id, type, reason, priority, due (days from today), status, completed (days ago), source]
    [memberId(6), "absentee_follow_up", `Absent from 3 consecutive services (threshold: ${threshold})`, "high", -2, "pending", null, "absentee"],
    [memberId(17), "absentee_follow_up", `Absent from 3 consecutive services (threshold: ${threshold})`, "high", 1, "in_progress", null, "absentee"],
    [memberId(22), "absentee_follow_up", `Absent from 3 consecutive services (threshold: ${threshold})`, "urgent", -5, "pending", null, "absentee"],
    [visitors[0].person.id, "visitor_follow_up", "First-time visitor last Sunday", "normal", 0, "pending", null, "manual"],
    [visitors[1].person.id, "visitor_follow_up", "First-time visitor last Sunday", "normal", 3, "pending", null, "manual"],
    [visitors[5].person.id, "home_visit", "Asked for a visit and prayer for the family", "normal", 6, "in_progress", null, "manual"],
    [visitors[3].person.id, "call", "Welcome call after first visit", "low", -12, "completed", 13, "manual"],
    [memberId(12), "encouragement", "Has been attending less often", "normal", 10, "pending", null, "manual"],
    [memberId(26), "prayer", "Requested prayer for health", "normal", -20, "completed", 19, "manual"],
    [memberId(18), "pastoral_conversation", "Asked to talk with a pastor", "high", -30, "completed", 27, "manual"],
    [memberId(27), "message", "New member check-in", "low", -8, "completed", 8, "manual"],
    [memberId(29), "call", "Reconnect with inactive member", "low", -40, "cancelled", null, "manual"],
  ];
  await insert("follow_ups", F.map(([person, type, reason, priority, due, status, completedAgo, source], i) => ({
    id: id(`follow-up:${i}`),
    person_id: person,
    follow_up_type: type,
    reason,
    assigned_to: adminId,
    priority,
    due_date: addDays(today, due),
    status,
    notes: status === "completed" ? "Done. (Demo record.)" : "Demo record.",
    completed_at: completedAgo === null ? null : `${addDays(today, -completedAgo)}T09:00:00Z`,
    source,
    is_demo: true,
  })));

  // --- pastoral care: a few neutral examples, one per confidentiality level ------------
  const C = [
    [memberId(26), "prayer", -6, "Prayer and encouragement", "Prayed together after the service. (Demo record.)", "care_team", false],
    [memberId(13), "home_visit", -15, "Home visitation", "Visited the family at home and prayed with them. (Demo record.)", "care_team", true],
    [memberId(4), "spiritual_guidance", -22, "General spiritual guidance", "Talked about next steps in discipleship. (Demo record.)", "care_team", false],
    [memberId(18), "encouragement", -28, "Ministry encouragement", "Encouraged to keep serving. (Demo record.)", "selected_leaders", false],
    [memberId(6), "marriage_family", -34, "Family prayer", "Prayed for the family. (Demo record.)", "pastor_only", true],
  ];
  const care = C.map(([person, type, days, summary, notes, level, followUp], i) => ({
    id: id(`care:${i}`), person_id: person, care_type: type, care_date: addDays(today, days), assigned_to: adminId,
    summary, notes, follow_up_required: followUp, follow_up_date: followUp ? addDays(today, days + 21) : null,
    confidentiality: level, is_demo: true,
  }));
  await insert("pastoral_care_records", care);
  if (adminId) {
    await insert("pastoral_care_access", [{ record_id: care[3].id, user_id: adminId }], "(record_id, user_id)");
  }

  // --- events -------------------------------------------------------------------------
  const E = [
    // [name, type, days from today, start, end, venue, organizer, status]
    ["Leadership Meeting", "training", -41, "18:30", "20:30", "Church annex", "Pastoral team", "completed"],
    ["Youth Fellowship", "fellowship", -27, "15:00", "18:00", "Main hall", "Youth ministry", "completed"],
    ["Worship Night", "church_event", -13, "19:00", "21:00", "Main hall", "Worship ministry", "completed"],
    ["Cell Leaders Meeting", "cell_meeting", -6, "19:00", "20:30", "Church annex", "Cell ministry", "completed"],
    ["Midweek Prayer Meeting", "prayer_meeting", 2, "19:00", "20:30", "Main hall", "Prayer Team", "upcoming"],
    ["Sunday Service", "sunday_service", weekday(today) === 0 ? 7 : 7 - weekday(today), "10:00", "12:00", "Main hall", "Pastoral team", "upcoming"],
    ["Church Fellowship", "fellowship", 12, "11:00", "15:00", "Covered court", "Administration", "upcoming"],
    ["Community Outreach", "outreach", 24, "08:00", "12:00", "Brgy. Demo covered court", "Outreach team", "upcoming"],
  ];
  const events = E.map(([name, type, days, start, end, venue, organizer, status], i) => ({
    id: id(`event:${i}`), name, event_type: type, event_date: addDays(today, days), start_time: start, end_time: end,
    venue, organizer, status, description: "Demo event for presentation.", is_demo: true,
  }));
  await insert("events", events);

  // Attendance for one past event (Worship Night).
  const worshipNight = events[2];
  const eventSessionId = id("session:event:worship-night");
  await insert("attendance_sessions", [{
    id: eventSessionId, attendance_type_id: eventType.id, title: worshipNight.name, session_date: worshipNight.event_date,
    cell_group_id: null, event_id: worshipNight.id, is_demo: true,
  }]);
  const eventRecords = [];
  for (const m of members) {
    if (m.profile !== "inactive" && m.joined <= worshipNight.event_date && random() < 0.6) {
      eventRecords.push({ id: id(`record:${eventSessionId}:${m.row.id}`), session_id: eventSessionId, person_id: m.row.id, status_id: PRESENT });
    }
  }
  for (const v of visitors.slice(7, 10)) {
    eventRecords.push({ id: id(`record:${eventSessionId}:${v.person.id}`), session_id: eventSessionId, person_id: v.person.id, status_id: PRESENT });
  }
  await insert("attendance_records", eventRecords, "(session_id, person_id)");

  // --- finance ------------------------------------------------------------------------
  // Categories are configuration: missing ones are added and are NOT removed with the demo data.
  for (const [table, names] of [
    ["giving_categories", ["Tithes", "Offering", "Missions", "Building Fund", "Special Offering"]],
    ["expense_categories", ["Utilities", "Ministry Supplies", "Transportation", "Outreach", "Events", "Maintenance"]],
  ]) {
    for (const name of names) {
      await client.query(
        `insert into public.${table} (name, sort_order)
         select $1, coalesce((select max(sort_order) from public.${table}), 0) + 10
         where not exists (select 1 from public.${table} where lower(name) = lower($1))`,
        [name],
      );
    }
  }
  const giveCat = Object.fromEntries((await all(`select id, name from public.giving_categories`)).map((c) => [c.name.toLowerCase(), c.id]));
  const spendCat = Object.fromEntries((await all(`select id, name from public.expense_categories`)).map((c) => [c.name.toLowerCase(), c.id]));

  const giving = [];
  const expenses = [];
  let g = 0;
  let x = 0;
  const give = (date, category, amount, notes = null) =>
    giving.push({
      id: id(`giving:${g}`), giving_date: date, category_id: giveCat[category], amount,
      reference_number: `DEMO-G-${String(++g).padStart(4, "0")}`, notes, recorded_by: adminId, is_demo: true,
    });
  const spend = (date, category, description, amount, payee) =>
    expenses.push({
      id: id(`expense:${x}`), expense_date: date, category_id: spendCat[category], description, amount, payee,
      reference_number: `DEMO-E-${String(++x).padStart(4, "0")}`, recorded_by: adminId, is_demo: true,
    });

  // Every Sunday for about six months: tithes and offering.
  for (let week = 25; week >= 0; week -= 1) {
    const sunday = addDays(lastSunday, -7 * week);
    give(sunday, "tithes", roundTo(between(18000, 31000), 50), "Sunday collection (demo)");
    give(sunday, "offering", roundTo(between(6500, 12500), 50), "Sunday collection (demo)");
  }
  // Monthly items, on fixed days of each of the last six months.
  for (let back = 5; back >= 0; back -= 1) {
    const first = addMonths(`${today.slice(0, 7)}-01`, -back);
    const on = (day) => addDays(first, day - 1);
    const push = (date, fn) => { if (date <= today) fn(date); };
    push(on(8), (d) => give(d, "missions", roundTo(between(5000, 9000), 100), "Monthly missions giving (demo)"));
    push(on(15), (d) => give(d, "building fund", roundTo(between(8000, 15000), 100), "Building fund pledge (demo)"));
    if (back % 2 === 0) push(on(22), (d) => give(d, "special offering", roundTo(between(4000, 11000), 100), "Special offering (demo)"));

    push(on(5), (d) => spend(d, "utilities", "Electricity and water", roundTo(between(6500, 9500), 10), "Davao utilities (demo)"));
    push(on(9), (d) => spend(d, "ministry supplies", "Kids ministry and worship supplies", roundTo(between(2500, 6000), 10), "Demo Supplies Store"));
    push(on(12), (d) => spend(d, "transportation", "Visitation and outreach transport", roundTo(between(1500, 3800), 10), "Fuel and fares (demo)"));
    push(on(18), (d) => spend(d, "outreach", "Community outreach materials", roundTo(between(3000, 8000), 10), "Outreach team (demo)"));
    if (back % 2 === 1) push(on(20), (d) => spend(d, "events", "Fellowship food and venue setup", roundTo(between(4000, 12000), 10), "Demo Catering"));
    push(on(25), (d) => spend(d, "maintenance", "Sound system and building upkeep", roundTo(between(2000, 7000), 10), "Demo Repair Services"));
  }
  await insert("giving_records", giving.filter((row) => row.category_id));
  await insert("expenses", expenses.filter((row) => row.category_id));

  // --- payment methods, accounts and transfers ------------------------------------------
  // Demo money sits in its own demo accounts, so real account balances are never affected.
  const demoAccounts = [
    { id: id("account:cash"), name: "Cash on Hand (Demo)", account_type: "cash", provider: null, account_holder: null, account_number: null, sort_order: 910 },
    { id: id("account:gcash"), name: "JAMC GCash (Demo)", account_type: "e_wallet", provider: "GCash", account_holder: "JAMC-Davao (Demo)", account_number: "0900 555 0101", sort_order: 920 },
    { id: id("account:bank"), name: "Main Bank Account (Demo)", account_type: "bank", provider: "Demo Bank", account_holder: "JAMC-Davao (Demo)", account_number: "0000 5555 0123 4567", sort_order: 930 },
  ];
  await insert("financial_accounts", demoAccounts.map((account) => ({ ...account, is_demo: true })));
  const [cashAcct, gcashAcct, bankAcct] = demoAccounts.map((account) => account.id);

  const methods = await all(`select id, kind from public.payment_methods where is_active order by sort_order`);
  const methodOf = (kind) => methods.find((method) => method.kind === kind)?.id ?? null;
  const [cashMethod, walletMethod, bankMethod] = [methodOf("cash"), methodOf("e_wallet"), methodOf("bank")];

  // Only demo rows that have no method yet are touched, so this is safe to repeat.
  if (cashMethod && walletMethod && bankMethod) {
    await client.query(
      `update public.giving_records g
       set payment_method_id = x.method, financial_account_id = x.account
       from (
         select g2.id,
           case
             when lower(c.name) in ('missions', 'building fund') then $3::uuid
             when lower(c.name) = 'special offering' then $2::uuid
             when lower(c.name) = 'tithes' and right(g2.reference_number, 1) in ('1', '5', '9') then $2::uuid
             else $1::uuid
           end as method,
           case
             when lower(c.name) in ('missions', 'building fund') then $6::uuid
             when lower(c.name) = 'special offering' then $5::uuid
             when lower(c.name) = 'tithes' and right(g2.reference_number, 1) in ('1', '5', '9') then $5::uuid
             else $4::uuid
           end as account
         from public.giving_records g2 join public.giving_categories c on c.id = g2.category_id
         where g2.is_demo and g2.payment_method_id is null
       ) x
       where g.id = x.id`,
      [cashMethod, walletMethod, bankMethod, cashAcct, gcashAcct, bankAcct],
    );
    await client.query(
      `update public.expenses e
       set payment_method_id = x.method, financial_account_id = x.account
       from (
         select e2.id,
           case when lower(c.name) in ('utilities', 'maintenance') then $3::uuid
                when lower(c.name) = 'outreach' then $2::uuid else $1::uuid end as method,
           case when lower(c.name) in ('utilities', 'maintenance') then $6::uuid
                when lower(c.name) = 'outreach' then $5::uuid else $4::uuid end as account
         from public.expenses e2 join public.expense_categories c on c.id = e2.category_id
         where e2.is_demo and e2.payment_method_id is null
       ) x
       where e.id = x.id`,
      [cashMethod, walletMethod, bankMethod, cashAcct, gcashAcct, bankAcct],
    );
  }

  // Deposits: cash on hand goes to the bank each month, and GCash is cashed out twice.
  const transfers = [];
  for (let back = 5; back >= 1; back -= 1) {
    const day = addDays(addMonths(`${today.slice(0, 7)}-01`, -back), 27);
    transfers.push({ key: `deposit:${back}`, from: cashAcct, to: bankAcct, amount: roundTo(between(60000, 95000), 500), date: day, notes: "Monthly cash deposit (demo)" });
  }
  transfers.push({ key: "cashout:1", from: gcashAcct, to: bankAcct, amount: 30000, date: addDays(today, -75), notes: "GCash to bank (demo)" });
  transfers.push({ key: "cashout:2", from: gcashAcct, to: bankAcct, amount: 25000, date: addDays(today, -18), notes: "GCash to bank (demo)" });
  await insert("account_transfers", transfers.map((transfer, i) => ({
    id: id(`transfer:${transfer.key}`), from_account_id: transfer.from, to_account_id: transfer.to, amount: transfer.amount,
    transfer_date: transfer.date, reference_number: `DEMO-T-${String(i + 1).padStart(4, "0")}`, notes: transfer.notes,
    recorded_by: adminId, is_demo: true,
  })));

  // --- tidy up: this is setup, not user activity ----------------------------------------
  // now() is constant inside a transaction, so this matches only what this run produced.
  await client.query(`delete from public.activity_logs where user_id is null and created_at = now()`);
  await client.query(`delete from public.notifications where created_at = now()`);

  // --dry-run does everything, reports it, then undoes it.
  const dryRun = process.argv.includes("--dry-run");
  await client.query(dryRun ? "rollback" : "commit");
  if (dryRun) console.log("DRY RUN: nothing was saved.\n");

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    console.log("Demo data is already loaded. Nothing was added.");
  } else {
    console.log("Demo data loaded:");
    for (const [table, added] of Object.entries(counts)) {
      if (added > 0) console.log(`  ${String(added).padStart(4)}  ${table}`);
    }
  }
  if (!adminId) console.log("\nNote: no Super Admin exists yet, so follow-ups and finance records are unassigned.");
  console.log("\nAll demo members have IDs starting with DEMO-. Remove everything with: npm run demo:remove");
} catch (error) {
  await client.query("rollback");
  console.error(`Seeding failed and was rolled back. Nothing was changed.\n  ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
