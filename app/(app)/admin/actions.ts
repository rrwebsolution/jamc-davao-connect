"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { z } from "zod";
import { P } from "@/lib/auth/permissions";
import { getAccess, getAccessWith } from "@/lib/auth/session";
import { isUuid } from "@/lib/data/common";
import { fail, INVALID_INPUT, NOT_ALLOWED } from "@/lib/errors";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { newUserSchema, roleSchema } from "@/lib/validation";

const NO_ADMIN_KEY: ActionResult<never> = {
  ok: false,
  error: "User management needs SUPABASE_SECRET_KEY to be set on the server.",
};

// --- Users -------------------------------------------------------------------

/**
 * Creates a login. The service-role key is used only for the Auth admin call;
 * the role is then assigned as the acting user, so RLS and the Super Admin
 * guard still decide whether that assignment is allowed.
 */
export async function createUser(input: unknown): Promise<ActionResult> {
  const access = await getAccessWith(P.usersManage);
  if (!access) return NOT_ALLOWED;
  if (!isAdminConfigured) return NO_ADMIN_KEY;

  const parsed = newUserSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;
  const { full_name, email, password, role_id, person_id } = parsed.data;

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (createError || !created.user) {
    const taken = /already|registered|exists/i.test(createError?.message ?? "");
    return fail(taken ? "A user with that email already exists." : (createError?.message ?? "The user could not be created."));
  }
  const userId = created.user.id;

  const supabase = await createClient();
  const { error: roleError } = await supabase.from("user_roles").insert({ user_id: userId, role_id });
  if (roleError) {
    // Don't leave a login behind without the role that was asked for.
    await admin.auth.admin.deleteUser(userId);
    return fail(roleError);
  }

  if (person_id) {
    const { data: linked, error: linkError } = await supabase
      .from("people")
      .update({ user_id: userId })
      .eq("id", person_id)
      .is("user_id", null)
      .select("id")
      .maybeSingle();
    if (linkError || !linked) {
      refresh();
      return {
        ok: true,
        message: "User created, but the member record could not be linked. You need permission to edit members to link one.",
      };
    }
  }

  refresh();
  return { ok: true };
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

  const headerList = await headers();
  const origin = headerList.get("origin") ?? `https://${headerList.get("host")}`;
  const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
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
