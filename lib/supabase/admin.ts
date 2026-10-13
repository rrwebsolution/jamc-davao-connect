import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/env";

const secretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const isAdminConfigured = Boolean(supabaseUrl && secretKey);

/**
 * Service-role client. It bypasses RLS, so it is only for Auth admin calls
 * (creating, banning and deleting logins) and only after the caller's
 * `users.manage` permission has been verified.
 */
export function createAdminClient() {
  if (!isAdminConfigured) {
    throw new Error("SUPABASE_SECRET_KEY is not set");
  }
  return createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
