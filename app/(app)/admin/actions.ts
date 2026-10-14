"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { P } from "@/lib/auth/permissions";
import { getAccess, getAccessWith } from "@/lib/auth/session";
import { isUuid } from "@/lib/data/common";
import { fail, INVALID_INPUT, NOT_ALLOWED } from "@/lib/errors";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { approvalSchema, loginEmailSchema, memberAccountSchema, roleSchema } from "@/lib/validation";

const NO_ADMIN_KEY: ActionResult<never> = {
  ok: false,
  error: "User management needs SUPABASE_SECRET_KEY to be set on the server.",
};

// --- Users -------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>;

/** Where links in invitation and reset emails point: the live site (see lib/site-url.ts). */
const requestOrigin = siteUrl;

/** Emails an invitation; the person chooses their own password from the link. */
async function invite(admin: Admin, email: string, fullName: string) {
  return admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${await requestOrigin()}/auth/confirm?next=/reset-password`,
  });
}

/**
 * Creates the login for an existing member. The name comes from the member
 * record; only the login email and role are chosen here.
 *
 * The service-role key is used only for the Auth admin call. The role is then
 * assigned as the acting user, so RLS and the role guard still decide whether
 * that assignment is allowed. If any step fails the new login is removed
 * again; the member record is never touched, so retrying cannot duplicate it.
 */
export async function createMemberAccount(personId: string, input: unknown): Promise<ActionResult> {
  if (!isUuid(personId)) return INVALID_INPUT;
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;
  if (!isAdminConfigured) return NO_ADMIN_KEY;

  const parsed = memberAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };
  const { email, password, role_id, method } = parsed.data;
  if (method === "password" && password.length < 8) {
    return fail("The temporary password needs at least 8 characters.");
  }

  const supabase = await createClient();
  const { data: person } = await supabase
    .from("people")
    .select("id, full_name, person_type, user_id, archived_at")
    .eq("id", personId)
    .maybeSingle();
  if (!person || person.person_type !== "member") return fail("That member could not be found.");
  if (person.archived_at) return fail("This member is archived. Restore the member before creating an account.");
  if (person.user_id) return fail(`${person.full_name} already has a system account.`);

  const admin = createAdminClient();
  const result =
    method === "invite"
      ? await invite(admin, email, person.full_name)
      : await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: person.full_name } });
  const userId = result.data?.user?.id;
  if (result.error || !userId) {
    const message = result.error?.message ?? "";
    if (/already|registered|exists/i.test(message)) {
      return fail("That login email is already used by another account. If it belongs to this member, link the existing account from Administration → Users.");
    }
    return fail(
      method === "invite"
        ? "The invitation email could not be sent. Check the project's email settings, or set a temporary password instead."
        : message || "The account could not be created.",
    );
  }

  // Role, approval and the link to the member: all as the acting user. The
  // database refuses a second account for the same member.
  const { error: roleError } = await supabase.from("user_roles").insert({ user_id: userId, role_id });
  const { error: approveError } = roleError
    ? { error: null }
    : await supabase.rpc("mark_admin_created", { target_user_id: userId, source: method === "invite" ? "invited" : "admin_created" });
  const { error: linkError } =
    roleError || approveError
      ? { error: null }
      : await supabase.rpc("link_member_account", { target_user_id: userId, target_person_id: personId });
  const failed = roleError ?? approveError ?? linkError;
  if (failed) {
    // Don't leave a login behind without its role or its member.
    await admin.auth.admin.deleteUser(userId);
    return fail(failed);
  }

  refresh();
  return { ok: true };
}

/** Links a login that has no member yet (an older account, or the first administrator). */
export async function linkAccountToMember(userId: string, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ person_id: z.string().uuid("Choose a member") }).safeParse(input);
  if (!isUuid(userId) || !parsed.success) return INVALID_INPUT;
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { error } = await supabase.rpc("link_member_account", { target_user_id: userId, target_person_id: parsed.data.person_id });
  if (error) return fail(error);

  refresh();
  return { ok: true };
}

/** May the acting user manage this account's sign-in details? Not for accounts that outrank them. */
async function outranks(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const [held, assignable] = await Promise.all([
    supabase.from("user_roles").select("role_id").eq("user_id", userId),
    supabase.rpc("assignable_roles"),
  ]);
  if (held.error || assignable.error) return true;
  const allowed = new Set(((assignable.data ?? []) as { id: string }[]).map((role) => role.id));
  return (held.data ?? []).some((row) => !allowed.has(row.role_id as string));
}

/**
 * Changes the email a person signs in with, through Supabase Auth. The
 * member's contact email is a separate field and is left alone.
 */
export async function changeLoginEmail(userId: string, input: unknown): Promise<ActionResult> {
  if (!isUuid(userId)) return INVALID_INPUT;
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;
  if (!isAdminConfigured) return NO_ADMIN_KEY;
  const parsed = loginEmailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };

  // Whoever controls the login email can reset the password, so this is only
  // allowed on accounts whose roles the acting user could assign themselves.
  const supabase = await createClient();
  if (await outranks(supabase, userId)) {
    return fail("Only a Super Admin can change the login email of this account.");
  }

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { email: parsed.data.email, email_confirm: true });
  if (error) {
    return fail(/already|registered|exists/i.test(error.message) ? "That email is already used by another account." : error.message || "The login email could not be changed.");
  }

  refresh();
  return { ok: true };
}

/** For someone who was invited but has not signed in yet. */
export async function resendInvitation(userId: string): Promise<ActionResult> {
  if (!isUuid(userId)) return INVALID_INPUT;
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;
  if (!isAdminConfigured) return NO_ADMIN_KEY;

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("email, full_name").eq("id", userId).maybeSingle();
  if (!profile) return NOT_ALLOWED;

  const { error } = await invite(createAdminClient(), profile.email, profile.full_name);
  if (error) {
    return fail(
      /already|registered|exists/i.test(error.message)
        ? "This person has already accepted their invitation. Send a password reset instead."
        : "The invitation email could not be sent. Check the project's email settings.",
    );
  }
  return { ok: true };
}

/** Role changes from a member's Account Access panel. Roles the admin may not assign are left as they are. */
export async function saveAccountRoles(userId: string, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ role_ids: z.array(z.string().uuid()).min(1, "Choose at least one role").max(20) }).safeParse(input);
  if (!isUuid(userId)) return INVALID_INPUT;
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const [held, assignable] = await Promise.all([
    supabase.from("user_roles").select("role_id").eq("user_id", userId),
    supabase.rpc("assignable_roles"),
  ]);
  if (held.error || assignable.error) return fail(held.error ?? assignable.error);
  const allowed = new Set(((assignable.data ?? []) as { id: string }[]).map((role) => role.id));
  const kept = (held.data ?? []).map((row) => row.role_id as string).filter((id) => !allowed.has(id));
  return setUserRoles(userId, [...new Set([...kept, ...parsed.data.role_ids])]);
}
export async function setUserRoles(userId: string, roleIds: unknown): Promise<ActionResult> {
  const parsed = z.array(z.string().uuid()).max(20).safeParse(roleIds);
  if (!isUuid(userId) || !parsed.success) return INVALID_INPUT;
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data: current, error } = await supabase.from("user_roles").select("role_id").eq("user_id", userId);
  if (error) return fail(error);

  const wanted = new Set(parsed.data);
  const existing = new Set((current ?? []).map((row) => row.role_id as string));
  const toAdd = [...wanted].filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !wanted.has(id));

  // Add first, so swapping roles never passes through "no Super Admin left".
  if (toAdd.length > 0) {
    const { error: addError } = await supabase.from("user_roles").insert(toAdd.map((role_id) => ({ user_id: userId, role_id })));
    if (addError) return fail(addError);
  }
  if (toRemove.length > 0) {
    const { error: removeError } = await supabase.from("user_roles").delete().eq("user_id", userId).in("role_id", toRemove);
    if (removeError) return fail(removeError);
  }

  refresh();
  return { ok: true };
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  if (!isUuid(userId)) return INVALID_INPUT;
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;
  if (userId === access.userId) return fail("You cannot deactivate your own account.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: active })
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return NOT_ALLOWED;

  // RLS already locks a deactivated profile out; banning also ends the session.
  if (isAdminConfigured) {
    await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  }

  refresh();
  return { ok: true };
}

export async function sendPasswordReset(userId: string): Promise<ActionResult> {
  if (!isUuid(userId)) return INVALID_INPUT;
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  if (!profile) return NOT_ALLOWED;

  const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
    redirectTo: `${await requestOrigin()}/auth/confirm?next=/reset-password`,
  });
  if (error) return fail(error.message || "The reset email could not be sent.");
  return { ok: true };
}

export async function updateProfileName(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ full_name: z.string().trim().min(1).max(120) }).safeParse(input);
  if (!parsed.success) return INVALID_INPUT;
  const access = await getAccess();
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", access.userId);
  if (error) return fail(error);

  refresh();
  return { ok: true };
}

// --- Account approvals -------------------------------------------------------

/** Approve a self-registered account: assign a role and, optionally, a member record. */
export async function approveRegistration(userId: string, input: unknown): Promise<ActionResult> {
  if (!isUuid(userId)) return INVALID_INPUT;
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;
  const raw = (input ?? {}) as Record<string, unknown>;
  const choice = String(raw.member_action ?? "");
  // "match:<id>" is a suggested member picked straight from the list.
  const parsed = approvalSchema.safeParse(
    choice.startsWith("match:") ? { ...raw, member_action: "link", link_person_id: choice.slice(6) } : input,
  );
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };

  // The database function re-checks the permission, which roles this admin may
  // hand out, and that a member is never linked to two logins.
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_registration", {
    target_user_id: userId,
    assign_role_id: parsed.data.role_id,
    member_action: parsed.data.member_action,
    link_person_id: parsed.data.member_action === "link" ? parsed.data.link_person_id : null,
  });
  if (error) return fail(error);

  refresh();
  return { ok: true };
}

export async function rejectRegistration(userId: string, input: unknown): Promise<ActionResult> {
  if (!isUuid(userId)) return INVALID_INPUT;
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;
  const parsed = z.object({ reason: z.string().trim().max(500).optional().default("") }).safeParse(input);
  if (!parsed.success) return INVALID_INPUT;

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_registration", { target_user_id: userId, reason: parsed.data.reason });
  if (error) return fail(error);

  refresh();
  return { ok: true };
}

// --- Roles & permissions -----------------------------------------------------

export async function saveRole(id: string | null, input: unknown): Promise<ActionResult> {
  if (id !== null && !isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith(P.rolesManage);
  if (!access) return NOT_ALLOWED;

  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;

  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("roles").update(parsed.data).eq("id", id).select("id").maybeSingle();
    if (error) return fail(error);
    if (!data) return NOT_ALLOWED;
  } else {
    const key = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!/^[a-z]/.test(key)) return fail("The role name must start with a letter.");
    const { error } = await supabase.from("roles").insert({ ...parsed.data, key });
    if (error) return fail(error, "A role with that name already exists.");
  }

  refresh();
  return { ok: true };
}

export async function deleteRole(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith(P.rolesManage);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data, error } = await supabase.from("roles").delete().eq("id", id).select("id").maybeSingle();
  if (error) return fail(error);
  if (!data) return NOT_ALLOWED;

  refresh();
  return { ok: true };
}

export async function setRolePermission(roleId: string, permissionId: string, granted: boolean): Promise<ActionResult> {
  if (!isUuid(roleId) || !isUuid(permissionId)) return INVALID_INPUT;
  const access = await getAccessWith(P.rolesManage);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { error } = granted
    ? await supabase
        .from("role_permissions")
        .upsert({ role_id: roleId, permission_id: permissionId }, { onConflict: "role_id,permission_id", ignoreDuplicates: true })
    : await supabase.from("role_permissions").delete().eq("role_id", roleId).eq("permission_id", permissionId);
  if (error) return fail(error);

  refresh();
  return { ok: true };
}
