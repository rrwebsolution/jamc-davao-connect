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
  person_cell_group_id: string | null;
  person_cell_group_name: string | null;
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

// --- Attendance Records: one set of filters for the figures, charts and list ---

export const RECORD_RANGES = [
  { value: "4w", label: "Last 4 weeks", days: 28 },
  { value: "8w", label: "Last 8 weeks", days: 56 },
  { value: "3m", label: "Last 3 months", months: 3 },
  { value: "6m", label: "Last 6 months", months: 6 },
  { value: "12m", label: "Last 12 months", months: 12 },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
] as const;
export type RecordRange = (typeof RECORD_RANGES)[number]["value"];
export const DEFAULT_RECORD_RANGE: RecordRange = "3m";

export type RecordFilters = {
  range: RecordRange;
  from: string | null;
  to: string | null;
  type: string | null;
  status: string | null;
  group: string | null;
  session: string | null;
  person: string | null;
  who: "member" | "visitor" | null;
  /** Person name search, with LIKE wildcards removed. */
  search: string | null;
};

const isDate = (value: string | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

function shiftDate(day: string, { days = 0, months = 0 }: { days?: number; months?: number }) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - months);
  date.setUTCDate(date.getUTCDate() - days + (months ? 1 : 0));
  return date.toISOString().slice(0, 10);
}

/**
 * Reads the Attendance Records filters from the URL. A preset range becomes
 * dates ending today (the church's today); "custom" keeps the chosen dates.
 */
export function resolveRecordFilters(params: Record<string, string | undefined>, today: string): RecordFilters {
  const preset = RECORD_RANGES.find((range) => range.value === params.range);
  // Older links set only from/to: treat them as a custom range.
  const range: RecordRange = preset ? preset.value : isDate(params.from) || isDate(params.to) ? "custom" : DEFAULT_RECORD_RANGE;
  const spec = RECORD_RANGES.find((item) => item.value === range)!;

  let from: string | null = null;
  let to: string | null = null;
  if (range === "custom") {
    from = isDate(params.from) ? params.from : null;
    to = isDate(params.to) ? params.to : null;
  } else if ("days" in spec) {
    from = shiftDate(today, { days: spec.days - 1 });
    to = today;
  } else if ("months" in spec) {
    from = shiftDate(today, { months: spec.months });
    to = today;
  }

  const search = (params.q ?? "").replace(/[%*_\\]/g, " ").trim();
  return {
    range,
    from,
    to,
    type: isUuid(params.type) ? params.type : null,
    status: isUuid(params.status) ? params.status : null,
    group: isUuid(params.group) ? params.group : null,
    session: isUuid(params.session) ? params.session : null,
    person: isUuid(params.person) ? params.person : null,
    who: params.who === "member" || params.who === "visitor" ? params.who : null,
    search: search || null,
  };
}

export type RecordsSummary = {
  marks: number;
  present: number;
  absent: number;
  sessions: number;
  members_present: number;
  visitors_present: number;
  unique_visitors: number;
  trend: { date: string; members: number; visitors: number; absent: number; sessions: number; session_id: string | null }[];
  statuses: { id: string; name: string; counts_as_present: boolean; total: number }[];
  groups: { id: string; name: string; present: number; total: number }[];
  monthly: { month: string; members: number; visitors: number }[];
  /** First-time visitors registered in the period (visitor profiles, as on the dashboard), marked or not. */
  new_visitors: number;
  first_visitors: {
    id: string;
    full_name: string;
    first_visit_date: string;
    service_name: string | null;
    /** "member" once converted. */
    person_type: "member" | "visitor";
    archived: boolean;
    marked_present: boolean;
  }[];
};

/** Totals and chart series for exactly the records the list shows, plus first-time visitors (migrations 0027, 0029). */
export async function getRecordsSummary(filters: RecordFilters): Promise<RecordsSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attendance_records_summary", {
    p_from: filters.from,
    p_to: filters.to,
    p_type: filters.type,
    p_status: filters.status,
    p_group: filters.group,
    p_session: filters.session,
    p_person_type: filters.who,
    p_search: filters.search,
    p_person: filters.person,
  });
  if (error) {
    console.error("Failed to summarise attendance records", describeError(error));
    return null;
  }
  return data as RecordsSummary;
}

/** Columns the records list can be sorted by (newest first by default). */
export const RECORD_SORTS = ["session_date", "person_name", "person_cell_group_name", "status_name"] as const;

export async function listRecords(filters: RecordFilters, from: number, sort?: { column: string | undefined; dir: string | undefined }) {
  const supabase = await createClient();
  let query = supabase.from("attendance_record_details").select("*", { count: "exact" });

  if (filters.status) query = query.eq("status_id", filters.status);
  if (filters.type) query = query.eq("attendance_type_id", filters.type);
  if (filters.person) query = query.eq("person_id", filters.person);
  if (filters.group) query = query.eq("person_cell_group_id", filters.group);
  if (filters.session) query = query.eq("session_id", filters.session);
  if (filters.who) query = query.eq("person_type", filters.who);
  if (filters.from) query = query.gte("session_date", filters.from);
  if (filters.to) query = query.lte("session_date", filters.to);
  if (filters.search) query = query.ilike("person_name", `%${filters.search}%`);

  const column = RECORD_SORTS.find((name) => name === sort?.column) ?? "session_date";
  const ascending = sort?.column === column ? sort.dir !== "desc" : column !== "session_date";
  if (column !== "session_date") query = query.order(column, { ascending, nullsFirst: false });
  const { data, count, error } = await query
    .order("session_date", { ascending: column === "session_date" ? ascending : false })
    .order("person_name")
    .order("id")
    .range(from, from + (await getPageSize()) - 1);
  if (error) {
    console.error("Failed to list attendance records", describeError(error));
  }
  return { rows: (data ?? []) as AttendanceRecordRow[], total: count ?? 0, failed: Boolean(error) };
}
/** Sessions in the chosen period and type, newest first, for the Service filter. */
export async function listSessionOptions(filters: RecordFilters) {
  const supabase = await createClient();
  let query = supabase.from("attendance_sessions").select("id, title, session_date").is("archived_at", null);
  if (filters.type) query = query.eq("attendance_type_id", filters.type);
  if (filters.from) query = query.gte("session_date", filters.from);
  if (filters.to) query = query.lte("session_date", filters.to);
  const { data } = await query.order("session_date", { ascending: false }).limit(100);
  return (data ?? []) as { id: string; title: string; session_date: string }[];
}
