// Applies the SQL files in supabase/migrations to the database, in order.
//
//   npm run db:migrate
//
// Reads SUPABASE_DB_URL from .env.local (Supabase dashboard -> Connect ->
// "Session pooler" connection string, with your database password filled in).
// Each file runs in its own transaction and is recorded, so re-running only
// applies files that have not been applied yet.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !(match[1] in process.env)) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No file: rely on the real environment.
  }
}
loadEnv(".env.local");

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("Set SUPABASE_DB_URL in .env.local first (Supabase dashboard -> Connect -> Session pooler).");
  process.exit(1);
}
if (connectionString.includes("[YOUR-PASSWORD]")) {
  console.error("Replace [YOUR-PASSWORD] in SUPABASE_DB_URL with your database password.");
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
} catch (error) {
  console.error(`Could not connect to the database: ${error.message}`);
  process.exit(1);
}

try {
  // Kept outside the public schema so it is never exposed through the API.
  await client.query(`
    create schema if not exists app_private;
    create table if not exists app_private.migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);
  const { rows } = await client.query("select name from app_private.migrations");
  const applied = new Set(rows.map((row) => row.name));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skipped  ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into app_private.migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`applied  ${file}`);
      count += 1;
    } catch (error) {
      await client.query("rollback");
      console.error(`FAILED   ${file}\n  ${error.message}`);
      console.error("Nothing from this file was kept. Earlier files stay applied.");
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) {
    console.log(count === 0 ? "\nDatabase is already up to date." : `\nDone: ${count} migration(s) applied.`);
  }
} finally {
  await client.end();
}
