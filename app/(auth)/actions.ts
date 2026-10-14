"use server";

import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth/permissions";
import { getAccess, getAccountState } from "@/lib/auth/session";
import { describeError, INVALID_INPUT } from "@/lib/errors";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { forgotPasswordSchema, loginSchema, passwordSchema, signUpSchema } from "@/lib/validation";

/** Only same-site paths are accepted as a post-login destination. */
function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : null;
}

export async function signIn(input: unknown, next?: string): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return INVALID_INPUT;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { ok: false, error: "Unable to sign in. Please check your email and password." };
  }

  // The password was right. Whether they may come in is a separate question.
  const { state } = await getAccountState();
  if (state === "pending" || state === "rejected") {
    // They stay signed in only as far as their status page.
    redirect("/pending-approval");
  }
  const access = await getAccess();
  if (state !== "active" || !access) {
    await supabase.auth.signOut();
    return { ok: false, error: "This account is not active. Please contact your administrator." };
  }

  redirect(safeNext(next) ?? homePathFor(access));
}

/**
 * Public registration. It creates the login and nothing else: the account is
 * pending (the database sets that, whatever is sent here) and has no role
 * until an administrator approves it.
 */
export async function signUp(input: unknown): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };
  }
  const { email, password, first_name, middle_name, last_name, mobile_number, is_existing_member, member_hint } = parsed.data;

  // Email links go to the live site, wherever the request came from (see lib/site-url.ts).
  const origin = await siteUrl();

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=/pending-approval`,
      data: {
        signup: "self",
        first_name,
        middle_name: middle_name ?? "",
        last_name,
        full_name: `${first_name} ${last_name}`,
        mobile_number,
        is_existing_member: is_existing_member ? "true" : "false",
        member_hint: is_existing_member ? (member_hint ?? "") : "",
      },
    },
  });

  if (error) {
    const message = error.message ?? "";
    if (/signups? (are )?(not allowed|disabled)/i.test(message)) {
      return { ok: false, error: "Online registration is currently closed. Please contact the church office." };
    }
    if (/password/i.test(message)) {
      return { ok: false, error: "Please choose a stronger password." };
    }
    if (/rate limit|too many/i.test(message)) {
      return { ok: false, error: "Too many attempts. Please wait a few minutes and try again." };
    }
    // An address that is already registered gets the same answer as a new one,
    // so this form can't be used to find out who has an account.
    if (!/already|registered|exists/i.test(message)) {
      console.error("Sign-up failed", describeError(error));
      return { ok: false, error: "We couldn't submit your registration. Please try again." };
    }
  }

  // Signing up must not leave a usable session behind.
  await supabase.auth.signOut();
  redirect("/sign-up/submitted");
}

/** For the status pages, which sit outside the signed-in app. */
export async function signOutToLogin() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(input: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return INVALID_INPUT;
  }

  // Email links go to the live site, wherever the request came from (see lib/site-url.ts).
  const origin = await siteUrl();

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  });
  if (error) {
    console.error("Password reset request failed", describeError(error));
  }
  // Same answer whether or not the address exists, so accounts can't be probed.
  return { ok: true };
}

export async function updatePassword(input: unknown): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    return INVALID_INPUT;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return { ok: false, error: "Your reset link has expired. Please request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { ok: false, error: error.message || "The password could not be changed." };
  }
  return { ok: true };
}
