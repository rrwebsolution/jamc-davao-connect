import "server-only";
import {
  CARE_TYPES,
  CONFIDENTIALITY,
  EVENT_STATUSES,
  EVENT_TYPES,
  FOLLOW_UP_STATUSES,
  FOLLOW_UP_TYPES,
  getCategoryOptions,
  labelOf,
  PRIORITIES,
  type SelectOption,
} from "@/lib/data/options";
import { getChurchSettings, getLookup, isUuid } from "@/lib/data/common";
import { getFinancialAccounts, getPaymentMethods } from "@/lib/data/finance";
import { getCellGroupOptions } from "@/lib/data/people";
import { formatDate, formatMonth, titleCase } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { VISITOR_STATUSES } from "@/lib/types";

// Every report reads through the signed-in user's own Supabase client, so a
// report (and its export) can never contain a row that RLS would not show
// the same user on the module's own screens.

export const REPORT_ROW_LIMIT = 2000;

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Params = Record<string, string | undefined>;
export type ReportRow = Record<string, string | number>;
export type ReportColumn = { key: string; label: string; numeric?: boolean };
export type ReportFilter = { key: string; label: string; options: SelectOption[] };

export type ReportResult = {
  columns: ReportColumn[];
  rows: ReportRow[];
  filters: ReportFilter[];
  /** Whether the From/To date filters apply, and to what. */
  dates?: string;
  summary?: string;
};

export type ReportDefinition = {
  slug: string;
  title: string;
  description: string;
  /** Needs any one of these, in addition to reports.view. */
  permissions: string[];
  load: (supabase: Supabase, params: Params) => Promise<ReportResult>;
};

const isDate = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
const active = (flag: boolean) => (flag ? "Active" : "Inactive");
const ACTIVE_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];
const peso = (value: number) => Math.round(value * 100) / 100;

export const REPORTS: ReportDefinition[] = [
  {
    slug: "membership",
    title: "Membership Report",
    description: "All members with their group, status and stage.",
    permissions: ["members.view", "members.view_assigned"],
    async load(supabase, params) {
      const [groups, ministries, settings] = await Promise.all([getCellGroupOptions(), getLookup("ministries"), getChurchSettings()]);
      let query = supabase.from("people_directory").select("*").eq("person_type", "member").is("archived_at", null);
      if (params.status === "active") query = query.eq("is_active", true);
      if (params.status === "inactive") query = query.eq("is_active", false);
      if (isUuid(params.group)) query = query.eq("cell_group_id", params.group);
      if (isUuid(params.ministry)) query = query.contains("ministry_ids", [params.ministry]);
      if (isDate(params.from)) query = query.gte("membership_date", params.from!);
      if (isDate(params.to)) query = query.lte("membership_date", params.to!);
      const { data } = await query.order("full_name").limit(REPORT_ROW_LIMIT);
      return {
        dates: "membership date",
        filters: [
          { key: "status", label: "Status", options: ACTIVE_OPTIONS },
          { key: "group", label: "Cell group", options: groups.map((g) => ({ value: g.id, label: g.name })) },
          { key: "ministry", label: "Ministry", options: ministries.map((m) => ({ value: m.id, label: m.name })) },
        ],
        columns: [
          { key: "code", label: "Member ID" },
          { key: "name", label: "Name" },
          { key: "gender", label: "Gender" },
          { key: "contact", label: "Contact" },
          { key: "group", label: "Cell group" },
          { key: "membership", label: "Membership" },
          { key: "stage", label: "Stage" },
          { key: "joined", label: "Date joined" },
          { key: "status", label: "Status" },
        ],
        rows: (data ?? []).map((p) => ({
          code: p.member_code ?? "",
          name: p.full_name,
          gender: p.gender ? titleCase(p.gender) : "",
          contact: p.contact_number ?? "",
          group: p.cell_group_name ?? "",
          membership: p.membership_status_name ?? "",
          stage: p.discipleship_stage_name ?? "",
          joined: p.membership_date ? formatDate(p.membership_date, settings.date_format) : "",
          status: active(p.is_active),
        })),
      };
    },
  },
  {
    slug: "visitors",
    title: "Visitor Report",
    description: "Visitors by first visit date and follow-up status.",
    permissions: ["visitors.view"],
    async load(supabase, params) {
      const settings = await getChurchSettings();
      let query = supabase.from("people_directory").select("*").not("first_visit_date", "is", null);
      if (params.status) query = query.eq("visitor_status", params.status);
      if (isDate(params.from)) query = query.gte("first_visit_date", params.from!);
      if (isDate(params.to)) query = query.lte("first_visit_date", params.to!);
      const { data } = await query.order("first_visit_date", { ascending: false }).limit(REPORT_ROW_LIMIT);
      return {
        dates: "first visit",
        filters: [{ key: "status", label: "Follow-up status", options: [...VISITOR_STATUSES] }],
        columns: [
          { key: "name", label: "Name" },
          { key: "contact", label: "Contact" },
          { key: "visit", label: "First visit" },
          { key: "service", label: "Service attended" },
          { key: "invited", label: "Invited by" },
          { key: "status", label: "Follow-up status" },
        ],
        rows: (data ?? []).map((p) => ({
          name: p.full_name,
          contact: p.contact_number ?? p.email ?? "",
          visit: formatDate(p.first_visit_date, settings.date_format),
          service: p.service_attended ?? "",
          invited: p.invited_by ?? "",
          status: labelOf(VISITOR_STATUSES, p.visitor_status),
        })),
      };
    },
  },
  {
    slug: "attendance",
    title: "Attendance Report",
    description: "Present and absent counts for each service or meeting.",
    permissions: ["attendance.view", "attendance.view_assigned"],
    async load(supabase, params) {
      const [types, settings] = await Promise.all([getLookup("attendance_types"), getChurchSettings()]);
      let query = supabase
        .from("attendance_sessions")
        .select("id, title, session_date, attendance_type:attendance_types(name), cell_group:cell_groups(name)")
        .is("archived_at", null);
      if (isUuid(params.type)) query = query.eq("attendance_type_id", params.type);
      if (isDate(params.from)) query = query.gte("session_date", params.from!);
      if (isDate(params.to)) query = query.lte("session_date", params.to!);
      const { data } = await query.order("session_date", { ascending: false }).limit(REPORT_ROW_LIMIT);
      const sessions = data ?? [];
      const { data: totalRows } = sessions.length
        ? await supabase.rpc("attendance_session_totals", { session_ids: sessions.map((s) => s.id) })
        : { data: [] };
      const totals = new Map(
        ((totalRows ?? []) as { session_id: string; present: number; absent: number; total: number }[]).map((t) => [t.session_id, t]),
      );
      let present = 0;
      const rows = sessions.map((s) => {
        const t = totals.get(s.id);
        const total = Number(t?.total ?? 0);
        present += Number(t?.present ?? 0);
        return {
          date: formatDate(s.session_date, settings.date_format),
          session: s.title,
          type: (s.attendance_type as unknown as { name: string } | null)?.name ?? "",
          group: (s.cell_group as unknown as { name: string } | null)?.name ?? "",
          present: Number(t?.present ?? 0),
          absent: Number(t?.absent ?? 0),
          rate: total ? `${Math.round((Number(t?.present ?? 0) / total) * 100)}%` : "",
        };
      });
      return {
        dates: "session date",
        filters: [{ key: "type", label: "Type", options: types.map((t) => ({ value: t.id, label: t.name })) }],
        columns: [
          { key: "date", label: "Date" },
          { key: "session", label: "Session" },
          { key: "type", label: "Type" },
          { key: "group", label: "Cell group" },
          { key: "present", label: "Present", numeric: true },
          { key: "absent", label: "Absent", numeric: true },
          { key: "rate", label: "Rate", numeric: true },
        ],
        rows,
        summary: rows.length ? `${rows.length} sessions · ${present} present in total · average ${Math.round(present / rows.length)} per session` : undefined,
      };
    },
  },
  {
    slug: "cell-groups",
    title: "Cell Group Report",
    description: "Membership and attendance of every cell group.",
    permissions: ["groups.view", "groups.manage_assigned"],
    async load(supabase, params) {
      let query = supabase.from("cell_group_directory").select("*").is("archived_at", null);
      if (params.status === "active") query = query.eq("is_active", true);
      if (params.status === "inactive") query = query.eq("is_active", false);
      const { data } = await query.order("name").limit(200);
      const groups = data ?? [];
      const stats = await Promise.all(groups.map((g) => supabase.rpc("cell_group_stats", { target_group_id: g.id })));
      return {
        filters: [{ key: "status", label: "Status", options: ACTIVE_OPTIONS }],
        columns: [
          { key: "group", label: "Cell group" },
          { key: "leader", label: "Leader" },
          { key: "meets", label: "Meets" },
          { key: "members", label: "Members", numeric: true },
          { key: "new", label: "New (30 days)", numeric: true },
          { key: "average", label: "Avg attendance", numeric: true },
          { key: "visitors", label: "Visitors", numeric: true },
          { key: "apprentices", label: "Apprentices", numeric: true },
          { key: "status", label: "Status" },
        ],
        rows: groups.map((g, index) => {
          const s = (stats[index].data ?? {}) as Record<string, number | null>;
          return {
            group: g.name,
            leader: g.leader_name ?? "",
            meets: g.meeting_day ? `${titleCase(g.meeting_day)}s` : "",
            members: Number(s.total_members ?? g.member_count ?? 0),
            new: Number(s.new_members ?? 0),
            average: s.average_attendance === null || s.average_attendance === undefined ? "" : Number(s.average_attendance),
            visitors: Number(s.visitors ?? 0),
            apprentices: Number(s.apprentices ?? 0),
            status: active(g.is_active),
          };
        }),
      };
    },
  },
  {
    slug: "follow-ups",
    title: "Follow-up Report",
    description: "Follow-ups by status, priority and due date.",
    permissions: ["care.view", "care.view_assigned"],
    async load(supabase, params) {
      const settings = await getChurchSettings();
      let query = supabase.from("follow_up_details").select("*");
      if (params.status) query = query.eq("status", params.status);
      if (params.priority) query = query.eq("priority", params.priority);
      if (params.type) query = query.eq("follow_up_type", params.type);
      if (isDate(params.from)) query = query.gte("due_date", params.from!);
      if (isDate(params.to)) query = query.lte("due_date", params.to!);
      const { data } = await query.order("due_date", { ascending: false, nullsFirst: false }).limit(REPORT_ROW_LIMIT);
      const rows = data ?? [];
      const overdue = rows.filter((r) => r.due_state === "overdue").length;
      return {
        dates: "due date",
        filters: [
          { key: "status", label: "Status", options: [...FOLLOW_UP_STATUSES] },
          { key: "priority", label: "Priority", options: [...PRIORITIES] },
          { key: "type", label: "Type", options: [...FOLLOW_UP_TYPES] },
        ],
        columns: [
          { key: "person", label: "Person" },
          { key: "type", label: "Type" },
          { key: "assigned", label: "Assigned to" },
          { key: "priority", label: "Priority" },
          { key: "due", label: "Due" },
          { key: "status", label: "Status" },
          { key: "completed", label: "Completed" },
        ],
        rows: rows.map((r) => ({
          person: r.person_name ?? "",
          type: labelOf(FOLLOW_UP_TYPES, r.follow_up_type),
          assigned: r.assigned_to_name ?? "Unassigned",
          priority: labelOf(PRIORITIES, r.priority),
          due: r.due_date ? formatDate(r.due_date, settings.date_format) : "",
          status: r.due_state === "overdue" ? "Overdue" : labelOf(FOLLOW_UP_STATUSES, r.status),
          completed: r.completed_at ? formatDate(r.completed_at, settings.date_format) : "",
        })),
        summary: rows.length ? `${rows.length} follow-ups · ${overdue} overdue` : undefined,
      };
    },
  },
  {
    slug: "pastoral-care",
    title: "Pastoral Care Summary",
    description: "How much care was given, by type. Counts only; no names or notes.",
    permissions: ["care.view", "care.confidential"],
    async load(supabase, params) {
      // Aggregated from the records this user can read, so confidential
      // records they cannot see are not even counted.
      let query = supabase.from("pastoral_care_records").select("care_type, follow_up_required, confidentiality");
      if (params.level) query = query.eq("confidentiality", params.level);
      if (isDate(params.from)) query = query.gte("care_date", params.from!);
      if (isDate(params.to)) query = query.lte("care_date", params.to!);
      const { data } = await query.limit(20000);
      const records = data ?? [];
      return {
        dates: "care date",
        filters: [{ key: "level", label: "Confidentiality", options: [...CONFIDENTIALITY] }],
        columns: [
          { key: "type", label: "Care type" },
          { key: "records", label: "Records", numeric: true },
          { key: "followups", label: "Follow-up required", numeric: true },
        ],
        rows: CARE_TYPES.map((type) => {
          const ofType = records.filter((r) => r.care_type === type.value);
          return { type: type.label, records: ofType.length, followups: ofType.filter((r) => r.follow_up_required).length };
        }).filter((row) => row.records > 0),
        summary: `${records.length} care records visible to you in this period`,
      };
    },
  },
  {
    slug: "discipleship",
    title: "Discipleship Report",
    description: "Each member's stage and mentor.",
    permissions: ["discipleship.view", "discipleship.view_assigned"],
    async load(supabase, params) {
      const stages = await getLookup("discipleship_stages");
      let query = supabase.from("people_directory").select("*").eq("person_type", "member").is("archived_at", null);
      if (params.stage === "none") query = query.is("discipleship_stage_id", null);
      else if (isUuid(params.stage)) query = query.eq("discipleship_stage_id", params.stage);
      if (params.mentor === "none") query = query.is("mentor_id", null);
      const { data } = await query.order("full_name").limit(REPORT_ROW_LIMIT);
      const rows = data ?? [];
      return {
        filters: [
          { key: "stage", label: "Stage", options: [...stages.map((s) => ({ value: s.id, label: s.name })), { value: "none", label: "No stage yet" }] },
          { key: "mentor", label: "Mentor", options: [{ value: "none", label: "No mentor" }] },
        ],
        columns: [
          { key: "name", label: "Member" },
          { key: "stage", label: "Stage" },
          { key: "mentor", label: "Mentor" },
          { key: "group", label: "Cell group" },
        ],
        rows: rows.map((p) => ({
          name: p.full_name,
          stage: p.discipleship_stage_name ?? "",
          mentor: p.mentor_name ?? "",
          group: p.cell_group_name ?? "",
        })),
        summary: rows.length ? `${rows.length} members · ${rows.filter((p) => p.mentor_id).length} with a mentor` : undefined,
      };
    },
  },
  {
    slug: "ministries",
    title: "Ministry Report",
    description: "Who serves in which ministry, and in what role.",
    permissions: ["ministries.view", "ministries.manage"],
    async load(supabase, params) {
      const [ministries, settings] = await Promise.all([getLookup("ministries"), getChurchSettings()]);
      let query = supabase.from("ministry_member_details").select("*");
      if (isUuid(params.ministry)) query = query.eq("ministry_id", params.ministry);
      if (params.status) query = query.eq("status", params.status);
      const { data } = await query.order("ministry_name").order("person_name").limit(REPORT_ROW_LIMIT);
      return {
        filters: [
          { key: "ministry", label: "Ministry", options: ministries.map((m) => ({ value: m.id, label: m.name })) },
          { key: "status", label: "Status", options: ACTIVE_OPTIONS },
        ],
        columns: [
          { key: "ministry", label: "Ministry" },
          { key: "member", label: "Member" },
          { key: "role", label: "Role" },
          { key: "joined", label: "Date joined" },
          { key: "status", label: "Status" },
        ],
        rows: (data ?? []).map((r) => ({
          ministry: r.ministry_name,
          member: r.person_name,
          role: r.role ?? "",
          joined: formatDate(r.date_assigned, settings.date_format),
          status: titleCase(r.status),
        })),
      };
    },
  },
  {
    slug: "events",
    title: "Event Report",
    description: "Events with their status and attendance.",
    permissions: ["events.view", "events.manage"],
    async load(supabase, params) {
      const settings = await getChurchSettings();
      let query = supabase.from("event_directory").select("*").is("archived_at", null);
      if (params.status) query = query.eq("status", params.status);
      if (params.type) query = query.eq("event_type", params.type);
      if (isDate(params.from)) query = query.gte("event_date", params.from!);
      if (isDate(params.to)) query = query.lte("event_date", params.to!);
      const { data } = await query.order("event_date", { ascending: false }).limit(REPORT_ROW_LIMIT);
      return {
        dates: "event date",
        filters: [
          { key: "status", label: "Status", options: [...EVENT_STATUSES] },
          { key: "type", label: "Type", options: [...EVENT_TYPES] },
        ],
        columns: [
          { key: "date", label: "Date" },
          { key: "event", label: "Event" },
          { key: "type", label: "Type" },
          { key: "venue", label: "Venue" },
          { key: "status", label: "Status" },
          { key: "attendance", label: "Attendance", numeric: true },
        ],
        rows: (data ?? []).map((e) => ({
          date: formatDate(e.event_date, settings.date_format),
          event: e.name,
          type: labelOf(EVENT_TYPES, e.event_type),
          venue: e.venue ?? "",
          status: labelOf(EVENT_STATUSES, e.status),
          attendance: e.session_id ? Number(e.attendance_count) : "",
        })),
      };
    },
  },
  {
    slug: "church-growth",
    title: "Church Growth Report",
    description: "New members, total members and new visitors, month by month.",
    permissions: ["members.view"],
    async load(supabase) {
      const { data } = await supabase.rpc("dashboard_stats");
      const stats = (data ?? {}) as {
        membership_growth?: { month: string; new_members: number; total_members: number }[];
        visitor_trend?: { month: string; visitors: number }[];
      };
      const visitors = new Map((stats.visitor_trend ?? []).map((v) => [v.month, v.visitors]));
      return {
        filters: [],
        columns: [
          { key: "month", label: "Month" },
          { key: "new", label: "New members", numeric: true },
          { key: "total", label: "Total members", numeric: true },
          { key: "visitors", label: "New visitors", numeric: true },
        ],
        rows: (stats.membership_growth ?? []).map((m) => ({
          month: formatMonth(m.month),
          new: m.new_members,
          total: m.total_members,
          visitors: visitors.get(m.month) ?? 0,
        })),
        summary: "The last 12 months.",
      };
    },
  },
  {
    slug: "finance",
    title: "Finance Report",
    description: "Giving and expenses in one ledger, with totals.",
    permissions: ["finance.view"],
    async load(supabase, params) {
      const [giving, expenses, settings, methods, accounts] = await Promise.all([
        getCategoryOptions("giving_categories"),
        getCategoryOptions("expense_categories"),
        getChurchSettings(),
        getPaymentMethods({ includeInactive: true }),
        getFinancialAccounts({ includeArchived: true }),
      ]);
      const wantGiving = params.kind !== "expenses";
      const wantExpenses = params.kind !== "giving";
      let g = supabase.from("giving_details").select("*");
      let e = supabase.from("expense_details").select("*");
      if (isUuid(params.category)) {
        g = g.eq("category_id", params.category);
        e = e.eq("category_id", params.category);
      }
      if (isUuid(params.method)) {
        g = g.eq("payment_method_id", params.method);
        e = e.eq("payment_method_id", params.method);
      }
      if (isUuid(params.account)) {
        g = g.eq("financial_account_id", params.account);
        e = e.eq("financial_account_id", params.account);
      }
      if (isDate(params.from)) {
        g = g.gte("giving_date", params.from!);
        e = e.gte("expense_date", params.from!);
      }
      if (isDate(params.to)) {
        g = g.lte("giving_date", params.to!);
        e = e.lte("expense_date", params.to!);
      }
      const [gRows, eRows] = await Promise.all([
        wantGiving ? g.order("giving_date", { ascending: false }).limit(REPORT_ROW_LIMIT) : { data: [] },
        wantExpenses ? e.order("expense_date", { ascending: false }).limit(REPORT_ROW_LIMIT) : { data: [] },
      ]);
      const ledger = [
        ...(gRows.data ?? []).map((r) => ({ date: r.giving_date as string, kind: "Giving", category: r.category_name, method: r.payment_method_name ?? "Not recorded", account: r.account_name ?? "", detail: r.notes ?? "", reference: r.reference_number ?? (r.check_number ? `Check ${r.check_number}` : ""), amount: Number(r.amount) })),
        ...(eRows.data ?? []).map((r) => ({ date: r.expense_date as string, kind: "Expense", category: r.category_name, method: r.payment_method_name ?? "Not recorded", account: r.account_name ?? "", detail: [r.description, r.payee].filter(Boolean).join(" — "), reference: r.reference_number ?? "", amount: Number(r.amount) })),
      ].sort((a, b) => b.date.localeCompare(a.date));
      // Giving split by how it was received: "Cash ₱…, GCash ₱…".
      const perMethod = new Map<string, number>();
      for (const row of ledger) {
        if (row.kind === "Giving") perMethod.set(row.method, (perMethod.get(row.method) ?? 0) + row.amount);
      }
      const totalGiving = ledger.filter((r) => r.kind === "Giving").reduce((sum, r) => sum + r.amount, 0);
      const totalExpenses = ledger.filter((r) => r.kind === "Expense").reduce((sum, r) => sum + r.amount, 0);
      const pesos = (value: number) => `₱${peso(value).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
      return {
        dates: "date",
        filters: [
          { key: "kind", label: "Transaction type", options: [{ value: "giving", label: "Giving" }, { value: "expenses", label: "Expenses" }] },
          { key: "category", label: "Category", options: [...giving, ...expenses] },
          { key: "method", label: "Payment method", options: methods.map((m) => ({ value: m.id, label: m.name })) },
          { key: "account", label: "Account", options: accounts.map((a) => ({ value: a.id, label: a.name })) },
        ],
        columns: [
          { key: "date", label: "Date" },
          { key: "kind", label: "Type" },
          { key: "category", label: "Category" },
          { key: "method", label: "Method" },
          { key: "account", label: "Account" },
          { key: "detail", label: "Details" },
          { key: "reference", label: "Reference" },
          { key: "amount", label: "Amount (₱)", numeric: true },
        ],
        rows: ledger.slice(0, REPORT_ROW_LIMIT).map((r) => ({ ...r, date: formatDate(r.date, settings.date_format), amount: peso(r.amount) })),
        summary:
          `Giving ${pesos(totalGiving)} · Expenses ${pesos(totalExpenses)} · Net ${pesos(totalGiving - totalExpenses)}` +
          (perMethod.size > 0
            ? ` — Giving by method: ${[...perMethod.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => `${name} ${pesos(value)}`).join(", ")}`
            : ""),
      };
    },
  },
  {
    slug: "account-transactions",
    title: "Account Transaction Report",
    description: "For each account: opening balance, giving received, expenses, transfers and the resulting balance.",
    permissions: ["finance.view"],
    async load(supabase, params) {
      const accounts = await getFinancialAccounts({ includeArchived: true });
      const { data } = await supabase.rpc("account_statement", {
        from_date: isDate(params.from) ? params.from : null,
        to_date: isDate(params.to) ? params.to : null,
      });
      type Line = {
        account_id: string; account_name: string; account_type: string; opening_balance: number;
        giving_received: number; expenses_paid: number; transfers_in: number; transfers_out: number; closing_balance: number;
      };
      const lines = ((data ?? []) as Line[]).filter((line) => !isUuid(params.account) || line.account_id === params.account);
      const total = lines.reduce((sum, line) => sum + Number(line.closing_balance), 0);
      return {
        dates: "transaction date (earlier activity is rolled into the opening balance)",
        filters: [{ key: "account", label: "Account", options: accounts.map((a) => ({ value: a.id, label: a.name })) }],
        columns: [
          { key: "account", label: "Account" },
          { key: "type", label: "Type" },
          { key: "opening", label: "Opening balance", numeric: true },
          { key: "giving", label: "+ Giving received", numeric: true },
          { key: "expenses", label: "− Expenses", numeric: true },
          { key: "out", label: "− Transfers out", numeric: true },
          { key: "in", label: "+ Transfers in", numeric: true },
          { key: "closing", label: "= Balance", numeric: true },
        ],
        rows: lines.map((line) => ({
          account: line.account_name,
          type: titleCase(line.account_type),
          opening: peso(Number(line.opening_balance)),
          giving: peso(Number(line.giving_received)),
          expenses: peso(Number(line.expenses_paid)),
          out: peso(Number(line.transfers_out)),
          in: peso(Number(line.transfers_in)),
          closing: peso(Number(line.closing_balance)),
        })),
        summary: lines.length
          ? `Total across ${lines.length} ${lines.length === 1 ? "account" : "accounts"}: ₱${peso(total).toLocaleString("en-PH", { minimumFractionDigits: 2 })}. Records with no account chosen are not in any balance.`
          : undefined,
      };
    },
  },
];

export const findReport = (slug: string) => REPORTS.find((report) => report.slug === slug) ?? null;
