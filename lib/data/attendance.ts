import "server-only";
import { isUuid, getPageSize } from "@/lib/data/common";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceSession } from "@/lib/types";
import { describeError } from "@/lib/errors";

export type PersonAttendanceStats = {
  total: number;
  present: number;
  absent: number;
  attendance_rate: number | null;
  consecutive_absences: number;
  last_attended: string | null;
  monthly: { month: string; present: number; absent: number }[];
};

/** A row of the `attendance_record_details` view. */
export type AttendanceRecordRow = {
  id: string;
  session_id: string;
  person_id: string;
  person_name: string;
  person_type: "member" | "visitor";
  status_name: string;
  counts_as_present: boolean;
  session_title: string;
  session_date: string;
  attendance_type_name: string;
  notes: string | null;
};

export async function getPersonAttendance(personId: string, limit = 25) {
  const supabase = await createClient();
  const [stats, records] = await Promise.all([
    supabase.rpc("person_attendance_stats", { target_person_id: personId }),
    supabase
      .from("attendance_record_details")
      .select("*")
      .eq("person_id", personId)
      .order("session_date", { ascending: false })
      .order("session_created_at", { ascending: false })
      .limit(limit),
  ]);
  return {
    stats: (stats.data as PersonAttendanceStats | null) ?? null,
    rows: (records.data ?? []) as AttendanceRecordRow[],
  };
}

export type SessionTotals = Record<string, { present: number; absent: number; total: number }>;

export async function listSessions(params: Record<string, string | undefined>, from: number) {
  const supabase = await createClient();
  let query = supabase
    .from("attendance_sessions")
    .select("*, attendance_type:attendance_types(name), cell_group:cell_groups(name)", { count: "exact" })
    .is("archived_at", null);

  if (isUuid(params.type)) query = query.eq("attendance_type_id", params.type);
  if (params.from) query = query.gte("session_date", params.from);
  if (params.to) query = query.lte("session_date", params.to);
  const term = (params.q ?? "").replace(/[%*]/g, " ").trim();
  if (term) query = query.ilike("title", `%${term}%`);

  const { data, count, error } = await query
    .order("session_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + (await getPageSize()) - 1);
  if (error) {
    console.error("Failed to list sessions", describeError(error));
  }

  const rows = (data ?? []) as AttendanceSession[];
  const totals: SessionTotals = {};
  if (rows.length > 0) {
    const { data: totalRows } = await supabase.rpc("attendance_session_totals", {
      session_ids: rows.map((row) => row.id),
    });
    for (const row of (totalRows ?? []) as { session_id: string; present: number; absent: number; total: number }[]) {
      totals[row.session_id] = { present: Number(row.present), absent: Number(row.absent), total: Number(row.total) };
    }
  }
  return { rows, totals, total: count ?? 0, failed: Boolean(error) };
}

export async function getSession(id: string): Promise<AttendanceSession | null> {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("attendance_sessions")
    .select("*, attendance_type:attendance_types(name), cell_group:cell_groups(name)")
    .eq("id", id)
    .maybeSingle();
  return (data as AttendanceSession | null) ?? null;
}

export type RosterPerson = {
  id: string;
  full_name: string;
  person_type: "member" | "visitor";
  member_code: string | null;
  cell_group_id: string | null;
  cell_group_name: string | null;
};

/** Everyone who can be marked for a session, plus what is already recorded. */
export async function getSessionRoster(session: AttendanceSession) {
  const supabase = await createClient();
  let people = supabase
    .from("people_directory")
    .select("id, full_name, person_type, member_code, cell_group_id, cell_group_name")
    .is("archived_at", null)
    .eq("is_active", true)
    .order("full_name")
    .limit(2000);
  // A cell meeting lists only that group's members.
  if (session.cell_group_id) {
    people = people.eq("cell_group_id", session.cell_group_id);
  }

  const [roster, records] = await Promise.all([
    people,
    supabase.from("attendance_records").select("person_id, status_id").eq("session_id", session.id),
  ]);

  const marks: Record<string, string> = {};
  for (const record of records.data ?? []) {
    marks[record.person_id] = record.status_id;
  }
  return { people: (roster.data ?? []) as RosterPerson[], marks };
}

export async function listRecords(params: Record<string, string | undefined>, from: number) {
  const supabase = await createClient();
  let query = supabase.from("attendance_record_details").select("*", { count: "exact" });

  if (isUuid(params.status)) query = query.eq("status_id", params.status);
  if (isUuid(params.type)) query = query.eq("attendance_type_id", params.type);
  if (isUuid(params.person)) query = query.eq("person_id", params.person);
  if (params.from) query = query.gte("session_date", params.from);
  if (params.to) query = query.lte("session_date", params.to);
  const term = (params.q ?? "").replace(/[%*]/g, " ").trim();
  if (term) query = query.ilike("person_name", `%${term}%`);

  const { data, count, error } = await query
    .order("session_date", { ascending: false })
    .order("person_name")
    .order("id")
    .range(from, from + (await getPageSize()) - 1);
  if (error) {
    console.error("Failed to list attendance records", describeError(error));
  }
  return { rows: (data ?? []) as AttendanceRecordRow[], total: count ?? 0, failed: Boolean(error) };
}