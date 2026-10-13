import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseKey, supabaseUrl } from "@/lib/env";
import { DEFAULT_BRANDING, type Branding } from "@/lib/theme";

export const BRANDING_TAG = "branding";

/**
 * Branding and theme, shared by every visitor (including the login page).
 * Read through get_public_branding(), the one function anon may call, and
 * cached; saving Appearance or General settings refreshes it with updateTag.
 */
export async function getBranding(): Promise<Branding> {
  "use cache";
  cacheTag(BRANDING_TAG);
  cacheLife("minutes");

  if (!isSupabaseConfigured) {
    return DEFAULT_BRANDING;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.rpc("get_public_branding");
    if (error || !data) {
      return DEFAULT_BRANDING;
    }
    return { ...DEFAULT_BRANDING, ...(data as Partial<Branding>) };
  } catch {
    return DEFAULT_BRANDING;
  }
}

/** Public URL of a file in the public `branding` bucket. */
export function brandingAssetUrl(path: string | null) {
  if (!path || !supabaseUrl) {
    return null;
  }
  return `${supabaseUrl}/storage/v1/object/public/branding/${path}`;
}
