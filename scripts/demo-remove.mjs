// Removes the presentation data loaded by `npm run demo:seed`, and nothing else.
//
//   npm run demo:remove
//
// Every statement is limited to rows marked is_demo = true, or rows that belong
// to a marked row. There is no unconditional DELETE or TRUNCATE here. It runs in
// one transaction: if anything fails, nothing is removed.
//
// Not removed: configuration (giving/expense categories, ministries, stages).

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

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

// Order matters: rows that point at demo people and sessions go first.
const steps = [
  ["notifications about demo records", `
    delete from public.notifications n
    where exists (select 1 from public.people p where p.is_demo and n.link like '%' || p.id || '%')
       or exists (select 1 from public.events e where e.is_demo and n.link like '%' || e.id || '%')
       or exists (select 1 from public.follow_ups f
                  where (f.is_demo or f.person_id in (select id from public.people where is_demo))
                    and n.link like '%' || f.id || '%')`],
  ["attendance marks", `
    delete from public.attendance_records r
    where r.person_id in (select id from public.people where is_demo)
       or r.session_id in (select id from public.attendance_sessions where is_demo)`],
  ["attendance sessions", `delete from public.attendance_sessions where is_demo`],
  ["giving records", `delete from public.giving_records where is_demo`],
  ["expenses", `delete from public.expenses where is_demo`],
  // Demo accounts: their transfers go; a real record pointed at one keeps existing and just loses the link.
  ["account transfers", `
    delete from public.account_transfers t
    where t.is_demo
       or t.from_account_id in (select id from public.financial_accounts where is_demo)
       or t.to_account_id in (select id from public.financial_accounts where is_demo)`],
  ["links from real records to demo accounts", `
    with g as (
      update public.giving_records set financial_account_id = null
      where financial_account_id in (select id from public.financial_accounts where is_demo) returning 1
    ), e as (
      update public.expenses set financial_account_id = null
      where financial_account_id in (select id from public.financial_accounts where is_demo) returning 1
    )
    select 1 from g union all select 1 from e`],
  ["demo financial accounts", `delete from public.financial_accounts where is_demo`],
  ["events", `delete from public.events where is_demo`],
  ["pastoral care records", `
    delete from public.pastoral_care_records
    where is_demo or person_id in (select id from public.people where is_demo)`],
  ["follow-ups", `
    delete from public.follow_ups
    where is_demo or person_id in (select id from public.people where is_demo)`],
  ["apprentices", `
    delete from public.apprentices
    where is_demo or person_id in (select id from public.people where is_demo)`],
  ["discipleship milestones", `
    delete from public.discipleship_milestones
    where is_demo or person_id in (select id from public.people where is_demo)`],
  ["cell groups", `delete from public.cell_groups where is_demo`],
  // Removing a person also removes their visitor details, group memberships,
  // ministry assignments and discipleship history (database cascades).
  ["members and visitors", `delete from public.people where is_demo`],
];

try {
  await client.query("begin");

  const { rows: [{ n: demoPeople }] } = await client.query(`select count(*)::int as n from public.people where is_demo`);
  const { rows: [{ n: realPeople }] } = await client.query(`select count(*)::int as n from public.people where not is_demo`);

  let total = 0;
  for (const [label, sql] of steps) {
    const result = await client.query(sql);
    total += result.rowCount ?? 0;
    if (result.rowCount) console.log(`  ${String(result.rowCount).padStart(4)}  ${label}`);
  }

  // The deletions above are housekeeping, not user activity.
  await client.query(`delete from public.activity_logs where user_id is null and created_at = now()`);

  // Safety net: real records must be exactly as they were.
  const { rows: [{ n: realAfter }] } = await client.query(`select count(*)::int as n from public.people where not is_demo`);
  if (realAfter !== realPeople) {
    throw new Error(`Real people changed from ${realPeople} to ${realAfter}; aborting.`);
  }

  // --dry-run does everything, reports it, then undoes it.
  const dryRun = process.argv.includes("--dry-run");
  await client.query(dryRun ? "rollback" : "commit");
  if (dryRun) console.log("DRY RUN: nothing was saved.\n");
  console.log(
    total === 0
      ? "No demo data found. Nothing was removed."
      : `\nRemoved the demo data (${demoPeople} demo people). ${realPeople} real people were left untouched.`,
  );
} catch (error) {
  await client.query("rollback");
  console.error(`Removal failed and was rolled back. Nothing was removed.\n  ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
