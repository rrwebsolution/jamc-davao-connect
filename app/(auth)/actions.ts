"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth/permissions";
import { getAccess } from "@/lib/auth/session";
import { describeError, INVALID_INPUT } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { forgotPasswordSchema, loginSchema, passwordSchema } from "@/lib/validation";

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

  const access = await getAccess();
  if (!access) {
    await supabase.auth.signOut();
    return { ok: false, error: "This account is not active. Please contact your administrator." };
  }

  redirect(safeNext(next) ?? homePathFor(access));
}

export async function requestPasswordReset(input: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return INVALID_INPUT;
  }

  const headerList = await headers();
  const origin = headerList.get("origin") ?? `https://${headerList.get("host")}`;

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
