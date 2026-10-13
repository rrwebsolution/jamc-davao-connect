import "server-only";
import { createClient } from "@/lib/supabase/server";

export type SelectOption = { value: string; label: string };

/** People the caller can see, for "person" pickers. RLS decides the list. */
export async function getPeopleOptions(type?: "member" | "visitor"): Promise<SelectOption[]> {
  const supabase = await createClient();
  let query = supabase
    .from("people")
    .select("id, full_name, person_type")
    .is("archived_at", null)
    .order("full_name")
    .limit(2000);
  if (type) query = query.eq("person_type", type);
  const { data } = await query;
  return (data ?? []).map((row) => ({
    value: row.id,
    label: row.person_type === "visitor" && !type ? `${row.full_name} (visitor)` : row.full_name,
  }));
}

/** Active users, for "assigned to" pickers. */
export async function getUserOptions(): Promise<SelectOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("assignable_users");
  return ((data ?? []) as { id: string; name: string }[]).map((row) => ({ value: row.id, label: row.name }));
}

export async function getCategoryOptions(table: "giving_categories" | "expense_categories"): Promise<SelectOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from(table).select("id, name").eq("is_active", true).order("sort_order").order("name");
  return (data ?? []).map((row) => ({ value: row.id, label: row.name }));
}

export const labelOf = (options: readonly { value: string; label: string }[], value: string | null | undefined) =>
  options.find((option) => option.value === value)?.label ?? (value ?? "—");

export const FOLLOW_UP_TYPES = [
  { value: "call", label: "Call" },
  { value: "message", label: "SMS / Message" },
  { value: "home_visit", label: "Home Visit" },
  { value: "prayer", label: "Prayer" },
  { value: "encouragement", label: "Encouragement" },
  { value: "pastoral_conversation", label: "Pastoral Conversation" },
  { value: "visitor_follow_up", label: "Visitor Follow-up" },
  { value: "absentee_follow_up", label: "Absentee Follow-up" },
  { value: "other", label: "Other" },
] as const;

export const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
] as const;

export const FOLLOW_UP_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export const CARE_TYPES = [
  { value: "counseling", label: "Counseling" },
  { value: "prayer", label: "Prayer" },
  { value: "hospital_visit", label: "Hospital Visit" },
  { value: "home_visit", label: "Home Visit" },
  { value: "bereavement", label: "Bereavement" },
  { value: "marriage_family", label: "Marriage / Family" },
  { value: "spiritual_guidance", label: "Spiritual Guidance" },
  { value: "encouragement", label: "Encouragement" },
  { value: "other", label: "Other" },
] as const;

export const CONFIDENTIALITY = [
  { value: "care_team", label: "Care Team" },
  { value: "selected_leaders", label: "Selected Leaders" },
  { value: "pastor_only", label: "Pastor Only" },
] as const;

export const EVENT_TYPES = [
  { value: "sunday_service", label: "Sunday Service" },
  { value: "prayer_meeting", label: "Prayer Meeting" },
  { value: "cell_meeting", label: "Cell Meeting" },
  { value: "church_event", label: "Church Event" },
  { value: "outreach", label: "Outreach" },
  { value: "training", label: "Training" },
  { value: "fellowship", label: "Fellowship" },
  { value: "other", label: "Other" },
] as const;

export const EVENT_STATUSES = [
  { value: "upcoming", label: "Upcoming" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export const WEEKDAYS = [
  { value: "sunday", label: "Sunday" },
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
] as const;

export const APPRENTICE_TRACKS = [
  { value: "cell_leader", label: "Cell Leader" },
  { value: "ministry_leader", label: "Ministry Leader" },
  { value: "mentor", label: "Mentor" },
] as const;

export const APPRENTICE_STATUSES = [
  { value: "active", label: "In training" },
  { value: "ready", label: "Ready to lead" },
  { value: "graduated", label: "Graduated" },
  { value: "paused", label: "Paused" },
] as const;
