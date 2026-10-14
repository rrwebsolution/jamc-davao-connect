// Creates the first Super Admin (or promotes an existing user).
//
//   npm run create-admin -- admin@example.com "A Strong Password" "Full Name"
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
// Run the SQL migrations first.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const [email, password, fullName = "Super Admin"] = process.argv.slice(2);

if (!url || !secret) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
  process.exit(1);
}
if (!email || !password || password.length < 8) {
  console.error('Usage: npm run create-admin -- <email> "<password, 8+ characters>" "<full name>"');
  process.exit(1);
}

const supabase = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: role, error: roleError } = await supabase.from("roles").select("id").eq("key", "super_admin").maybeSingle();
if (roleError || !role) {
  console.error("Could not find the super_admin role. Have the migrations been run?", roleError?.message ?? "");
  process.exit(1);
}

let userId;
const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
});

if (created?.user) {
  userId = created.user.id;
  console.log(`Created user ${email}`);
} else {
  // Already registered: promote the existing account instead.
  const { data: profile } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  if (!profile) {
    console.error(`Could not create ${email}: ${createError?.message ?? "unknown error"}`);
    process.exit(1);
  }
  userId = profile.id;
  console.log(`${email} already exists; promoting it (password left unchanged).`);
}

const { error: assignError } = await supabase
  .from("user_roles")
  .upsert({ user_id: userId, role_id: role.id }, { onConflict: "user_id,role_id", ignoreDuplicates: true });
if (assignError) {
  console.error(`Could not assign the Super Admin role: ${assignError.message}`);
  process.exit(1);
}

// New accounts start pending; the first administrator has nobody to approve them.
const { error: approveError } = await supabase
  .from("profiles")
  .update({ approval_status: "approved", account_status: "active", registration_source: "admin_created", approved_at: new Date().toISOString() })
  .eq("id", userId);
if (approveError) {
  console.error(`Could not activate the account: ${approveError.message}`);
  process.exit(1);
}

console.log(`${email} is now a Super Admin. Sign in at /login.`);
