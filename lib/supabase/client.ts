import { createBrowserClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl } from "@/lib/env";

/** Browser client. Used for file uploads and password updates; still under RLS. */
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseKey);
}
