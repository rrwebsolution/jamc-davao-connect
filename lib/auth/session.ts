import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { can, type Access } from "@/lib/auth/permissions";
import { describeError } from "@/lib/errors";

/**
 * Where a visitor stands, in the order the checks are made:
 *   signed_out  no session
 *   pending     signed in, waiting for an administrator's approval
 *   rejected    signed in, registration was not approved
 *   suspended   signed in, approved once but switched off since
 *   active      signed in, approved and active (roles and permissions apply)
 */
export type AccountState = "signed_out" | "pending" | "rejected" | "suspended" | "active";

type Session = { state: AccountState; access: Access | null; email: string | null };

/** One database call per request, shared by everything below. */
const getSession = cache(async (): Promise<Session> => {
  const signedOut: Session = { state: "signed_out", access: null, email: null };
  if (!isSupabaseConfigured) {
    return signedOut;
  }

  // Checking a session compares the token's expiry with the current time, so
  // it must run at request time and never as part of a prerendered shell.
  await connection();

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return signedOut;
  }

  const { data, error } = await supabase.rpc("get_my_access");
  if (error) {
    console.error("get_my_access failed", describeError(error));
    return signedOut;
  }

  const profile = data?.profile;
  if (!profile) {
    return signedOut;
  }
  // Approval comes before everything else: an account that is not approved
  // and active gets no Access object, so no page or action can act for it.
  if (profile.approval_status === "pending") return { state: "pending", access: null, email: profile.email };
  if (profile.approval_status === "rejected") return { state: "rejected", access: null, email: profile.email };
  if (!profile.is_active) return { state: "suspended", access: null, email: profile.email };

  return {
    state: "active",
    email: profile.email,
    access: {
      userId: profile.id,
      email: profile.email,
      fullName: profile.full_name || profile.email,
      themePreference: profile.theme_preference ?? null,
      roles: data.roles ?? [],
      permissions: data.permissions ?? [],
      personId: data.person_id ?? null,
    },
  };
});

/** The signed-in user with their roles and permissions, or null unless approved and active. */
export async function getAccess(): Promise<Access | null> {
  return (await getSession()).access;
}

export async function getAccountState(): Promise<{ state: AccountState; email: string | null }> {
  const { state, email } = await getSession();
  return { state, email };
}

/**
 * For pages and layouts. Signed-out visitors go to the login page; accounts
 * that are signed in but not approved and active go to their status page.
 * Knowing a protected URL is not enough to get past this.
 */
export async function requireAccess(): Promise<Access> {
  const { state, access } = await getSession();
  if (state === "active" && access) {
    return access;
  }
  redirect(state === "signed_out" ? "/login" : "/pending-approval");
}

/**
 * For Server Actions: returns the caller only if they hold one of the given
 * permissions. RLS enforces the same rule again at the database.
 */
export async function getAccessWith(...keys: string[]): Promise<Access | null> {
  const access = await getAccess();
  return access && can(access, ...keys) ? access : null;
}