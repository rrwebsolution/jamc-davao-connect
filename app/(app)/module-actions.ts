"use server";

// Server Actions for the Groups, Care, Discipleship, Ministries, Events and
// Finance modules. Each one checks the caller's permission, validates with
// Zod, and writes as the signed-in user, so RLS decides in the end.

import { refresh } from "next/cache";
import { P } from "@/lib/auth/permissions";
import { getAccess, getAccessWith } from "@/lib/auth/session";
import { getChurchToday, isUuid } from "@/lib/data/common";
import { fail, INVALID_INPUT, NOT_ALLOWED } from "@/lib/errors";
import { deleteRow, patchRow, saveRow } from "@/lib/save-row";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import {
  apprenticeSchema,
  discipleshipSchema,
  eventSchema,
  expenseSchema,
  financialAccountSchema,
  followUpSchema,
  givingSchema,
  groupSchema,
  milestoneSchema,
  ministryAssignmentSchema,
  ministrySchema,
  pastoralCareSchema,
  paymentMethodSchema,
  transferSchema,
} from "@/lib/validation";

type Saved = ActionResult<{ id: string }>;

const GROUP_EDITORS = [P.groupsManage, "groups.manage_assigned"];
const CARE_EDITORS = ["care.manage", "care.manage_assigned"];
const DISCIPLESHIP_EDITORS = [P.discipleshipManage, "discipleship.manage_assigned"];

// --- Cell groups -------------------------------------------------------------

export async function saveGroup(id: string | null, input: unknown): Promise<Saved> {
  return saveRow({
    table: "cell_groups",
    id,
    input,
    schema: groupSchema,
    permissions: id ? GROUP_EDITORS : [P.groupsManage],
  });
}

export async function setGroupArchived(id: string, archived: boolean): Promise<ActionResult> {
  return patchRow({
    table: "cell_groups",
    id,
    values: { archived_at: archived ? new Date().toISOString() : null, is_active: !archived },
    permissions: [P.groupsManage],
  });
}

/** Moves a member into the group. Their previous membership is closed, not deleted. */
export async function addGroupMember(groupId: string, personId: string): Promise<ActionResult> {
  if (!isUuid(groupId) || !isUuid(personId)) return INVALID_INPUT;
  if (!(await getAccessWith(P.groupsManage, P.membersUpdate))) return NOT_ALLOWED;

  const supabase = await createClient();
  const today = await getChurchToday();
  const { data: current } = await supabase
    .from("cell_group_members")
    .select("id, cell_group_id")
    .eq("person_id", personId)
    .is("left_at", null)
    .maybeSingle();
  if (current?.cell_group_id === groupId) return { ok: true };
  if (current) {
    const { error } = await supabase.from("cell_group_members").update({ left_at: today }).eq("id", current.id);
    if (error) return fail(error);
  }
  const { error } = await supabase
    .from("cell_group_members")
    .insert({ cell_group_id: groupId, person_id: personId, joined_at: today });
  if (error) return fail(error);

  refresh();
  return { ok: true };
}

export async function removeGroupMember(groupId: string, personId: string): Promise<ActionResult> {
  if (!isUuid(groupId) || !isUuid(personId)) return INVALID_INPUT;
  if (!(await getAccessWith(...GROUP_EDITORS, P.membersUpdate))) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cell_group_members")
    .update({ left_at: await getChurchToday() })
    .eq("cell_group_id", groupId)
    .eq("person_id", personId)
    .is("left_at", null)
    .select("id");
  if (error) return fail(error);
  if (!data?.length) return NOT_ALLOWED;

  refresh();
  return { ok: true };
}

export async function saveApprentice(groupId: string, id: string | null, input: unknown): Promise<Saved> {
  if (!isUuid(groupId)) return INVALID_INPUT;
  return saveRow({
    table: "apprentices",
    id,
    input,
    schema: apprenticeSchema,
    permissions: [P.groupsManage, P.discipleshipManage],
    prepare: (values) => ({ ...values, cell_group_id: groupId }),
  });
}

export async function removeApprentice(id: string): Promise<ActionResult> {
  return deleteRow({ table: "apprentices", id, permissions: [P.groupsManage, P.discipleshipManage] });
}

// --- Follow-ups --------------------------------------------------------------

export async function saveFollowUp(id: string | null, input: unknown): Promise<Saved> {
  // Editing is also open to the assignee, who may hold no care permission, so
  // edits are gated by sign-in here and by the row's update policy in the database.
  return saveRow({
    table: "follow_ups",
    id,
    input,
    schema: followUpSchema,
    permissions: id ? [] : CARE_EDITORS,
  });
}

export async function setFollowUpStatus(id: string, status: string): Promise<ActionResult> {
  if (!isUuid(id) || !["pending", "in_progress", "completed", "cancelled"].includes(status)) return INVALID_INPUT;
  if (!(await getAccess())) return NOT_ALLOWED;

  // No permission gate here on purpose: an assignee without care.manage may
  // complete their own follow-up, and the update policy checks exactly that.
  const supabase = await createClient();
  const { data, error } = await supabase.from("follow_ups").update({ status }).eq("id", id).select("id").maybeSingle();
  if (error) return fail(error);
  if (!data) return NOT_ALLOWED;

  refresh();
  return { ok: true };
}

// --- Pastoral care -----------------------------------------------------------

export async function savePastoralCare(id: string | null, input: unknown): Promise<Saved> {
  const parsed = pastoralCareSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };
  const sharedWith = parsed.data.confidentiality === "selected_leaders" ? parsed.data.shared_with : [];

  const saved = await saveRow({
    table: "pastoral_care_records",
    id,
    input,
    schema: pastoralCareSchema,
    permissions: ["care.manage"],
    prepare: (values) => {
      const { shared_with, ...record } = values;
      void shared_with;
      return { ...record, follow_up_date: record.follow_up_required ? record.follow_up_date : null };
    },
  });
  if (!saved.ok) return saved;

  // Replace the "selected leaders" list. Only the author (or a holder of
  // care.confidential) passes the policy, so a failure here is not fatal.
  const supabase = await createClient();
  const recordId = saved.data!.id;
  const { data: current } = await supabase.from("pastoral_care_access").select("user_id").eq("record_id", recordId);
  const existing = new Set((current ?? []).map((row) => row.user_id as string));
  const wanted = new Set(sharedWith);
  const toAdd = [...wanted].filter((userId) => !existing.has(userId));
  const toRemove = [...existing].filter((userId) => !wanted.has(userId));
  if (toAdd.length > 0) {
    await supabase.from("pastoral_care_access").insert(toAdd.map((user_id) => ({ record_id: recordId, user_id })));
  }
  if (toRemove.length > 0) {
    await supabase.from("pastoral_care_access").delete().eq("record_id", recordId).in("user_id", toRemove);
  }
  return saved;
}

export async function deletePastoralCare(id: string): Promise<ActionResult> {
  return deleteRow({ table: "pastoral_care_records", id, permissions: ["care.manage"] });
}

// --- Discipleship ------------------------------------------------------------

/** Advance a stage and/or change mentor. History is kept by the database. */
export async function setDiscipleship(personId: string, input: unknown): Promise<ActionResult> {
  if (!isUuid(personId)) return INVALID_INPUT;
  if (!(await getAccessWith(...DISCIPLESHIP_EDITORS))) return NOT_ALLOWED;
  const parsed = discipleshipSchema.safeParse(input);
  if (!parsed.success) return INVALID_INPUT;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_discipleship", {
    target_person_id: personId,
    new_stage_id: parsed.data.stage_id,
    new_mentor_id: parsed.data.mentor_id,
    stage_notes: parsed.data.notes,
  });
  if (error) return fail(error);

  refresh();
  return { ok: true };
}

export async function saveMilestone(personId: string, id: string | null, input: unknown): Promise<Saved> {
  if (!isUuid(personId)) return INVALID_INPUT;
  return saveRow({
    table: "discipleship_milestones",
    id,
    input,
    schema: milestoneSchema,
    permissions: DISCIPLESHIP_EDITORS,
    prepare: (values) => ({ ...values, person_id: personId }),
  });
}

export async function deleteMilestone(id: string): Promise<ActionResult> {
  return deleteRow({ table: "discipleship_milestones", id, permissions: DISCIPLESHIP_EDITORS });
}

// --- Ministries --------------------------------------------------------------

export async function saveMinistry(id: string | null, input: unknown): Promise<Saved> {
  return saveRow({ table: "ministries", id, input, schema: ministrySchema, permissions: [P.ministriesManage] });
}

export async function setMinistryArchived(id: string, archived: boolean): Promise<ActionResult> {
  return patchRow({
    table: "ministries",
    id,
    values: { archived_at: archived ? new Date().toISOString() : null, is_active: !archived },
    permissions: [P.ministriesManage],
  });
}

export async function saveMinistryAssignment(ministryId: string, id: string | null, input: unknown): Promise<Saved> {
  if (!isUuid(ministryId)) return INVALID_INPUT;
  if (id !== null && !isUuid(id)) return INVALID_INPUT;
  if (!(await getAccessWith(P.ministriesManage))) return NOT_ALLOWED;
  const parsed = ministryAssignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };

  const supabase = await createClient();
  // One row per member per ministry: assigning again updates the existing row.
  const { data, error } = await supabase
    .from("ministry_members")
    .upsert({ ...parsed.data, ministry_id: ministryId }, { onConflict: "ministry_id,person_id" })
    .select("id")
    .single();
  if (error) return fail(error);

  refresh();
  return { ok: true, data: { id: data.id } };
}

export async function removeMinistryAssignment(id: string): Promise<ActionResult> {
  return deleteRow({ table: "ministry_members", id, permissions: [P.ministriesManage] });
}

// --- Events ------------------------------------------------------------------

export async function saveEvent(id: string | null, input: unknown): Promise<Saved> {
  return saveRow({ table: "events", id, input, schema: eventSchema, permissions: ["events.manage"] });
}

export async function setEventStatus(id: string, status: string): Promise<ActionResult> {
  if (!["upcoming", "ongoing", "completed", "cancelled"].includes(status)) return INVALID_INPUT;
  return patchRow({ table: "events", id, values: { status }, permissions: ["events.manage"] });
}

/** Returns the attendance session for an event, creating it on first use. */
export async function openEventAttendance(eventId: string): Promise<Saved> {
  if (!isUuid(eventId)) return INVALID_INPUT;
  if (!(await getAccessWith("events.manage", P.attendanceCreate))) return NOT_ALLOWED;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("attendance_sessions")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (existing) return { ok: true, data: { id: existing.id } };

  const { data: event } = await supabase.from("events").select("name, event_date").eq("id", eventId).maybeSingle();
  if (!event) return NOT_ALLOWED;

  const { data: types } = await supabase.from("attendance_types").select("id, name").eq("is_active", true).order("sort_order");
  const type = types?.find((item) => item.name === "Special Event") ?? types?.[0];
  if (!type) return fail("Add an attendance type in Settings first.");

  const { data, error } = await supabase
    .from("attendance_sessions")
    .insert({ attendance_type_id: type.id, title: event.name, session_date: event.event_date, event_id: eventId })
    .select("id")
    .single();
  if (error) return fail(error);
  return { ok: true, data: { id: data.id } };
}

// --- Finance -----------------------------------------------------------------

// Which account types a payment method may be paired with. Check and Other
// can land anywhere (a check is usually deposited into a bank account).
const ACCOUNT_TYPES_FOR: Record<string, string[] | null> = {
  cash: ["cash"],
  e_wallet: ["e_wallet"],
  bank: ["bank"],
  check: null,
  other: null,
};

/**
 * Category, payment method and account are three different facts. This keeps
 * the last two consistent with each other and applies the method's own rules.
 */
async function paymentProblem(values: {
  payment_method_id: string;
  financial_account_id: string;
  reference_number: string | null;
  check_number?: string | null;
}): Promise<string | null> {
  const supabase = await createClient();
  const [method, account] = await Promise.all([
    supabase.from("payment_methods").select("name, kind, requires_reference, is_active").eq("id", values.payment_method_id).maybeSingle(),
    supabase.from("financial_account_directory").select("name, account_type, is_active, archived_at").eq("id", values.financial_account_id).maybeSingle(),
  ]);
  if (!method.data) return "That payment method could not be found.";
  if (!account.data || account.data.archived_at) return "That account could not be found.";

  const allowed = ACCOUNT_TYPES_FOR[method.data.kind];
  if (allowed && !allowed.includes(account.data.account_type)) {
    return `${method.data.name} can't be recorded against ${account.data.name}. Choose a matching account.`;
  }
  if (method.data.requires_reference && !values.reference_number) {
    return `A reference number is required for ${method.data.name}.`;
  }
  if (method.data.kind === "check" && values.check_number !== undefined && !values.check_number) {
    return "Enter the check number.";
  }
  return null;
}

export async function saveGiving(id: string | null, input: unknown): Promise<Saved> {
  const parsed = givingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };
  const problem = await paymentProblem(parsed.data);
  if (problem) return fail(problem);

  // Replacing or removing a receipt: the old file is deleted after the save.
  const supabase = await createClient();
  const before = id && isUuid(id)
    ? (await supabase.from("giving_records").select("proof_path").eq("id", id).maybeSingle()).data?.proof_path
    : null;

  const saved = await saveRow({
    table: "giving_records",
    id,
    input,
    schema: givingSchema,
    permissions: ["finance.manage"],
    prepare: (values) => {
      const isCheck = values.check_number || values.check_bank || values.check_date;
      return isCheck ? values : { ...values, check_number: null, check_bank: null, check_date: null };
    },
  });
  if (saved.ok && before && before !== parsed.data.proof_path) {
    await supabase.storage.from("payment-proofs").remove([before]);
  }
  return saved;
}

export async function deleteGiving(id: string): Promise<ActionResult> {
  return deleteRow({ table: "giving_records", id, permissions: ["finance.manage"] });
}

export async function saveExpense(id: string | null, input: unknown): Promise<Saved> {
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? INVALID_INPUT.error };
  const problem = await paymentProblem(parsed.data);
  if (problem) return fail(problem);
  return saveRow({ table: "expenses", id, input, schema: expenseSchema, permissions: ["finance.manage"] });
}

// --- Payment methods, accounts, transfers --------------------------------------

const FINANCE_SETUP = ["finance.manage", P.settingsManage];

export async function savePaymentMethod(id: string | null, input: unknown): Promise<Saved> {
  return saveRow({
    table: "payment_methods",
    id,
    input,
    schema: paymentMethodSchema,
    permissions: FINANCE_SETUP,
    prepare: (values) => (id ? values : { ...values, sort_order: Math.floor(Date.now() / 1000) }),
  });
}

export async function saveFinancialAccount(id: string | null, input: unknown): Promise<Saved> {
  return saveRow({ table: "financial_accounts", id, input, schema: financialAccountSchema, permissions: ["finance.manage"] });
}

export async function setAccountArchived(id: string, archived: boolean): Promise<ActionResult> {
  return patchRow({
    table: "financial_accounts",
    id,
    values: { archived_at: archived ? new Date().toISOString() : null, is_active: !archived },
    permissions: ["finance.manage"],
  });
}

/** An internal move between two church accounts. Never counted as giving or as an expense. */
export async function saveTransfer(id: string | null, input: unknown): Promise<Saved> {
  return saveRow({ table: "account_transfers", id, input, schema: transferSchema, permissions: ["finance.manage"] });
}

export async function deleteTransfer(id: string): Promise<ActionResult> {
  return deleteRow({ table: "account_transfers", id, permissions: ["finance.manage"] });
}

export async function deleteExpense(id: string): Promise<ActionResult> {
  return deleteRow({ table: "expenses", id, permissions: ["finance.manage"] });
}

// --- Notifications -----------------------------------------------------------

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export async function loadNotifications(): Promise<{ items: NotificationItem[]; unread: number }> {
  if (!(await getAccess())) return { items: [], unread: 0 };

  const supabase = await createClient();
  // Produces today's due/overdue, birthday and event reminders for this user.
  await supabase.rpc("refresh_my_notifications");
  const [list, unread] = await Promise.all([
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(20),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  return { items: (list.data ?? []) as NotificationItem[], unread: unread.count ?? 0 };
}

export async function markNotificationsRead(id?: string): Promise<ActionResult> {
  if (id !== undefined && !isUuid(id)) return INVALID_INPUT;
  if (!(await getAccess())) return NOT_ALLOWED;

  const supabase = await createClient();
  let query = supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (id) query = query.eq("id", id);
  const { error } = await query;
  if (error) return fail(error);
  return { ok: true };
}
