// Marks the first visit of visitors registered before migration 0030 as
// attendance: Present in that day's session of the service they came to.
//
//   npm run first-visit:backfill            shows who would be marked (changes nothing)
//   npm run first-visit:backfill -- --apply  adds those marks
//
// Only adds marks; a mark that already exists is never changed. The work is
// done by public.backfill_first_visit_marks() in the database, in one
// transaction.

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
const apply = process.argv.includes("--apply");

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  // The same rule as the database function, listed so the change can be checked first.
  const { rows } = await client.query(`
    select p.full_name, vp.first_visit_date::text as visit, s.title, s.session_date::text as session_date
    from public.visitor_profiles vp
    join public.people p on p.id = vp.person_id and p.archived_at is null
    join public.attendance_sessions s on s.id = public.first_visit_session(vp.first_visit_date, vp.attendance_type_id)
    where not exists (select 1 from public.attendance_records r where r.person_id = vp.person_id and r.session_id = s.id)
    order by vp.first_visit_date, p.full_name`);

  if (rows.length === 0) {
    console.log("Every first visit with a matching session is already marked. Nothing to do.");
  } else {
    console.log(`${rows.length} first ${rows.length === 1 ? "visit" : "visits"} to mark Present:`);
    for (const row of rows) console.log(`  ${row.visit}  ${row.full_name}  →  ${row.title} (${row.session_date})`);
  }

  if (!apply) {
    if (rows.length > 0) console.log("\nNothing was changed. Run again with --apply to add these marks.");
  } else if (rows.length > 0) {
    await client.query("begin");
    const { rows: [{ added }] } = await client.query("select public.backfill_first_visit_marks(false) as added");
    await client.query("commit");
    console.log(`\nAdded ${added} ${added === 1 ? "mark" : "marks"}.`);
  }
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
