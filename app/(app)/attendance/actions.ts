"use server";

import { refresh } from "next/cache";
import { P } from "@/lib/auth/permissions";
import { getAccessWith } from "@/lib/auth/session";
import { isUuid } from "@/lib/data/common";
import { fail, INVALID_INPUT, NOT_ALLOWED } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { attendanceMarksSchema, sessionSchema } from "@/lib/validation";

const RECORDERS = [P.attendanceCreate, P.attendanceUpdate, P.attendanceManageAssigned];

export async function saveSession(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (id !== null && !isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith(...RECORDERS);
  if (!access) return NOT_ALLOWED;

  const parsed = sessionSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;

  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase
      .from("attendance_sessions")
      .update(parsed.data)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) return fail(error);
    if (!data) return NOT_ALLOWED;
    refresh();
    return { ok: true, data: { id } };
  }

  const { data, error } = await supabase.from("attendance_sessions").insert(parsed.data).select("id").single();
  if (error) return fail(error);
  return { ok: true, data: { id: data.id } };
}

export async function archiveSession(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return INVALID_INPUT;
  const access = await getAccessWith(P.attendanceUpdate, P.attendanceManageAssigned);
  if (!access) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_sessions")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error);
  if (!data) return NOT_ALLOWED;
  return { ok: true };
}

/**
 * Saves the marks that changed in the recorder. A null status clears the
 * person's record for this session.
 */
export async function saveAttendance(input: unknown): Promise<ActionResult<{ saved: number }>> {
  const access = await getAccessWith(...RECORDERS);
  if (!access) return NOT_ALLOWED;

  const parsed = attendanceMarksSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;
  const { session_id, marks } = parsed.data;

  const supabase = await createClient();
  const toSave = marks.filter((mark) => mark.status_id !== null);
  const toClear = marks.filter((mark) => mark.status_id === null).map((mark) => mark.person_id);

  if (toSave.length > 0) {
    const { error } = await supabase.from("attendance_records").upsert(
      toSave.map((mark) => ({ session_id, person_id: mark.person_id, status_id: mark.status_id })),
      { onConflict: "session_id,person_id" },
    );
    if (error) return fail(error);
  }
  if (toClear.length > 0) {
    const { error } = await supabase
      .from("attendance_records")
      .delete()
      .eq("session_id", session_id)
      .in("person_id", toClear);
    if (error) return fail(error);
  }

  refresh();
  return { ok: true, data: { saved: marks.length } };
}
