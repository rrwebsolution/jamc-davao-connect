import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { can, type Access } from "@/lib/auth/permissions";
import { describeError } from "@/lib/errors";

/**
 * The signed-in user with their roles and permissions, or null.
 * Memoized per request, so layouts, pages and actions can all call it freely.
 */
export const getAccess = cache(async (): Promise<Access | null> => {
  if (!isSupabaseConfigured) {
    return null;
  }

  // Checking a session compares the token's expiry with the current time, so
  // it must run at request time and never as part of a prerendered shell.
  await connection();

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return null;
  }

  const { data, error } = await supabase.rpc("get_my_access");
  if (error) {
    console.error("get_my_access failed", describeError(error));
    return null;
  }

  const profile = data?.profile;
  if (!profile || !profile.is_active) {
    return null;
  }

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name || profile.email,
    themePreference: profile.theme_preference ?? null,
    roles: data.roles ?? [],
    permissions: data.permissions ?? [],
    personId: data.person_id ?? null,
  };
});

/** For pages and layouts: sends signed-out visitors to the login page. */
export async function requireAccess(): Promise<Access> {
  const access = await getAccess();
  if (!access) {
    redirect("/login");
  }
  return access;
}

/**
 * For Server Actions: returns the caller only if they hold one of the given
 * permissions. RLS enforces the same rule again at the database.
 */
export async function getAccessWith(...keys: string[]): Promise<Access | null> {
  const access = await getAccess();
  return access && can(access, ...keys) ? access : null;
}
