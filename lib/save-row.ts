import "server-only";
import { refresh } from "next/cache";
import type { ZodTypeAny, z } from "zod";
import { getAccess, getAccessWith } from "@/lib/auth/session";
import { isUuid } from "@/lib/data/common";
import { fail, INVALID_INPUT, NOT_ALLOWED } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

type Saved = ActionResult<{ id: string }>;

/**
 * The shared shape of a create/update Server Action: check the caller holds
 * one of the permissions, validate with Zod, then insert or update as the
 * signed-in user so RLS has the final say.
 */
export async function saveRow<S extends ZodTypeAny>(options: {
  table: string;
  id: string | null;
  input: unknown;
  schema: S;
  permissions: string[];
  /** Adjust the validated values before they are written. */
  prepare?: (values: z.output<S>) => Record<string, unknown>;
}): Promise<Saved> {
  const { table, id, input, schema, permissions, prepare } = options;
  if (id !== null && !isUuid(id)) return INVALID_INPUT;
  // An empty list means "any signed-in user": the row's RLS policy decides.
  const caller = permissions.length > 0 ? await getAccessWith(...permissions) : await getAccess();
  if (!caller) return NOT_ALLOWED;

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };
  }
  const values = prepare ? prepare(parsed.data) : (parsed.data as Record<string, unknown>);

  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from(table).update(values).eq("id", id).select("id").maybeSingle();
    if (error) return fail(error);
    if (!data) return NOT_ALLOWED;
    refresh();
    return { ok: true, data: { id } };
  }

  const { data, error } = await supabase.from(table).insert(values).select("id").single();
  if (error) return fail(error);
  refresh();
  return { ok: true, data: { id: data.id } };
}

/** Update a few columns of one row (archive, cancel, complete...). */
export async function patchRow(options: {
  table: string;
  id: string;
  values: Record<string, unknown>;
  permissions: string[];
}): Promise<ActionResult> {
  if (!isUuid(options.id)) return INVALID_INPUT;
  if (!(await getAccessWith(...options.permissions))) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(options.table)
    .update(options.values)
    .eq("id", options.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return NOT_ALLOWED;
  refresh();
  return { ok: true };
}

export async function deleteRow(options: { table: string; id: string; permissions: string[] }): Promise<ActionResult> {
  if (!isUuid(options.id)) return INVALID_INPUT;
  if (!(await getAccessWith(...options.permissions))) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data, error } = await supabase.from(options.table).delete().eq("id", options.id).select("id").maybeSingle();
  if (error) return fail(error);
  if (!data) return NOT_ALLOWED;
  refresh();
  return { ok: true };
}
