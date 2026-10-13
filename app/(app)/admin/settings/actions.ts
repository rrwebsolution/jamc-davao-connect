"use server";

import { refresh, updateTag } from "next/cache";
import { can, P, type Access } from "@/lib/auth/permissions";
import { getAccess, getAccessWith } from "@/lib/auth/session";
import { BRANDING_TAG } from "@/lib/branding";
import { isUuid, type LookupTable } from "@/lib/data/common";
import { fail, INVALID_INPUT, NOT_ALLOWED } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_COLORS } from "@/lib/theme";
import type { ActionResult } from "@/lib/types";
import {
  appearanceSchema,
  attendanceSettingsSchema,
  generalSettingsSchema,
  lookupSchema,
  membershipSettingsSchema,
} from "@/lib/validation";

// --- Church settings ---------------------------------------------------------

async function updateChurchSettings(values: Record<string, unknown>): Promise<ActionResult> {
  const access = await getAccessWith(P.settingsManage);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("church_settings")
    .update({ ...values, updated_by: access.userId })
    .eq("id", true)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return NOT_ALLOWED;

  // The church name is part of the cached public branding.
  updateTag(BRANDING_TAG);
  refresh();
  return { ok: true };
}

export async function saveGeneralSettings(input: unknown): Promise<ActionResult> {
  const parsed = generalSettingsSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;
  try {
    new Intl.DateTimeFormat("en", { timeZone: parsed.data.timezone });
  } catch {
    return fail("That timezone isn't recognised. Use a name like Asia/Manila.");
  }
  return updateChurchSettings(parsed.data);
}

export async function saveMembershipSettings(input: unknown): Promise<ActionResult> {
  const parsed = membershipSettingsSchema.safeParse(input);
  return parsed.success ? updateChurchSettings(parsed.data) : INVALID_INPUT;
}

export async function setTrackIndividualGiving(enabled: boolean): Promise<ActionResult> {
  return updateChurchSettings({ track_individual_giving: Boolean(enabled) });
}

export async function saveAttendanceSettings(input: unknown): Promise<ActionResult> {
  const parsed = attendanceSettingsSchema.safeParse(input);
  return parsed.success ? updateChurchSettings(parsed.data) : INVALID_INPUT;
}

// --- Branding & appearance ---------------------------------------------------

const ASSET_FIELDS = ["logo_path", "login_logo_path", "login_logo_dark_path", "favicon_path", "login_background_path"] as const;

export async function saveAppearance(input: unknown): Promise<ActionResult> {
  const access = await getAccessWith(P.appearanceManage);
  if (!access) return NOT_ALLOWED;

  const parsed = appearanceSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;

  const supabase = await createClient();
  const { data: before } = await supabase.from("system_appearance_settings").select("*").maybeSingle();

  const { data, error } = await supabase
    .from("system_appearance_settings")
    .update({ ...parsed.data, updated_by: access.userId })
    .eq("id", true)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return NOT_ALLOWED;

  // Remove files that were replaced or removed. Best effort.
  const stale = ASSET_FIELDS.map((field) => before?.[field] as string | null).filter(
    (path, index): path is string => Boolean(path) && path !== parsed.data[ASSET_FIELDS[index]],
  );
  if (stale.length > 0) {
    await supabase.storage.from("branding").remove(stale);
  }

  updateTag(BRANDING_TAG);
  refresh();
  return { ok: true };
}

/** Puts colours and theme mode back to the defaults. Names and images are kept. */
export async function resetAppearance(): Promise<ActionResult> {
  const access = await getAccessWith(P.appearanceManage);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("system_appearance_settings")
    .update({ ...DEFAULT_COLORS, default_theme: "light", allow_user_theme_override: true, updated_by: access.userId })
    .eq("id", true)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return NOT_ALLOWED;

  updateTag(BRANDING_TAG);
  refresh();
  return { ok: true };
}

// --- Demo data ---------------------------------------------------------------

/**
 * Removes the presentation data. The database function checks for Super Admin
 * itself and only touches rows marked is_demo; this check just fails early.
 */
export async function removeDemoData(): Promise<ActionResult> {
  const access = await getAccess();
  if (!access || !access.roles.some((role) => role.key === "super_admin")) return NOT_ALLOWED;

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_demo_data");
  if (error) return fail(error, "The demo data could not be removed. Nothing was changed.");

  refresh();
  return { ok: true };
}

// --- Configurable lists ------------------------------------------------------

const LOOKUPS: Record<LookupTable, { permissions: string[]; flag?: string; hasDefault?: boolean; hasDescription?: boolean }> = {
  membership_statuses: { permissions: [P.settingsManage], hasDefault: true },
  baptism_statuses: { permissions: [P.settingsManage], hasDefault: true },
  attendance_types: { permissions: [P.settingsManage], flag: "counts_for_absence" },
  attendance_statuses: { permissions: [P.settingsManage], flag: "counts_as_present" },
  discipleship_stages: { permissions: [P.settingsManage, P.discipleshipManage], hasDescription: true },
  ministries: { permissions: [P.ministriesManage], hasDescription: true },
  giving_categories: { permissions: [P.settingsManage, "finance.manage"] },
  expense_categories: { permissions: [P.settingsManage, "finance.manage"] },
  payment_methods: { permissions: [P.settingsManage, "finance.manage"] },
};

async function lookupAccess(table: string): Promise<{ access: Access; table: LookupTable } | null> {
  if (!Object.hasOwn(LOOKUPS, table)) return null;
  const access = await getAccess();
  const config = LOOKUPS[table as LookupTable];
  return access && can(access, ...config.permissions) ? { access, table: table as LookupTable } : null;
}

export async function saveLookup(tableName: string, id: string | null, input: unknown): Promise<ActionResult> {
  if (id !== null && !isUuid(id)) return INVALID_INPUT;
  const allowed = await lookupAccess(tableName);
  if (!allowed) return NOT_ALLOWED;
  const config = LOOKUPS[allowed.table];

  const parsed = lookupSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;

  const values: Record<string, unknown> = { name: parsed.data.name, is_active: parsed.data.is_active };
  if (config.hasDescription) values.description = parsed.data.description;
  if (config.flag) values[config.flag] = Boolean(parsed.data.flag);

  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from(allowed.table).update(values).eq("id", id).select("id").maybeSingle();
    if (error) return fail(error);
    if (!data) return NOT_ALLOWED;
  } else {
    const { data: last } = await supabase
      .from(allowed.table)
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase.from(allowed.table).insert({ ...values, sort_order: (last?.sort_order ?? 0) + 10 });
    if (error) return fail(error);
  }

  refresh();
  return { ok: true };
}

export async function moveLookup(tableName: string, id: string, direction: "up" | "down"): Promise<ActionResult> {
  if (!isUuid(id)) return INVALID_INPUT;
  const allowed = await lookupAccess(tableName);
  if (!allowed) return NOT_ALLOWED;

  const supabase = await createClient();
  let query = supabase.from(allowed.table).select("id, sort_order").order("sort_order").order("name");
  if (allowed.table === "ministries") query = query.is("archived_at", null);
  const { data: rows, error } = await query;
  if (error || !rows) return fail(error);

  const index = rows.findIndex((row) => row.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= rows.length) return { ok: true };

  const reordered = [...rows];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  for (const [position, row] of reordered.entries()) {
    const sortOrder = (position + 1) * 10;
    if (row.sort_order !== sortOrder) {
      const { error: updateError } = await supabase.from(allowed.table).update({ sort_order: sortOrder }).eq("id", row.id);
      if (updateError) return fail(updateError);
    }
  }

  refresh();
  return { ok: true };
}

export async function setDefaultLookup(tableName: string, id: string): Promise<ActionResult> {
  if (!isUuid(id)) return INVALID_INPUT;
  const allowed = await lookupAccess(tableName);
  if (!allowed || !LOOKUPS[allowed.table].hasDefault) return NOT_ALLOWED;

  const supabase = await createClient();
  const { error: clearError } = await supabase.from(allowed.table).update({ is_default: false }).neq("id", id);
  if (clearError) return fail(clearError);
  const { error } = await supabase.from(allowed.table).update({ is_default: true }).eq("id", id);
  if (error) return fail(error);

  refresh();
  return { ok: true };
}

/** Deletes a list item, or archives it when it is a ministry (which keeps its history). */
export async function removeLookup(tableName: string, id: string): Promise<ActionResult> {
  if (!isUuid(id)) return INVALID_INPUT;
  const allowed = await lookupAccess(tableName);
  if (!allowed) return NOT_ALLOWED;

  const supabase = await createClient();
  const result =
    allowed.table === "ministries"
      ? await supabase
          .from("ministries")
          .update({ archived_at: new Date().toISOString(), is_active: false })
          .eq("id", id)
          .select("id")
          .maybeSingle()
      : await supabase.from(allowed.table).delete().eq("id", id).select("id").maybeSingle();

  if (result.error) {
    return fail(result.error, "This item is in use. Turn it off instead of deleting it.");
  }
  if (!result.data) return NOT_ALLOWED;

  refresh();
  return { ok: true };
}
