// Row shapes for the tables and views the app reads. Kept by hand to match
// supabase/migrations; regenerate with `supabase gen types` once the CLI is set up.

export type Lookup = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  is_default?: boolean;
  description?: string | null;
  counts_for_absence?: boolean;
  counts_as_present?: boolean;
};

export type PersonType = "member" | "visitor";

export const VISITOR_STATUSES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "follow_up_scheduled", label: "Follow-up Scheduled" },
  { value: "returning", label: "Returning Visitor" },
  { value: "connected_to_cell_group", label: "Connected to Cell Group" },
  { value: "became_member", label: "Became Member" },
] as const;

export type VisitorStatus = (typeof VISITOR_STATUSES)[number]["value"];

export const CIVIL_STATUSES = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "widowed", label: "Widowed" },
  { value: "separated", label: "Separated" },
] as const;

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
] as const;

/** A row of the `people_directory` view. */
export type Person = {
  id: string;
  person_type: PersonType;
  member_code: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  nickname: string | null;
  full_name: string;
  gender: "male" | "female" | null;
  birthdate: string | null;
  civil_status: string | null;
  contact_number: string | null;
  email: string | null;
  address: string | null;
  photo_path: string | null;
  date_first_attended: string | null;
  membership_date: string | null;
  membership_status_id: string | null;
  baptism_status_id: string | null;
  baptism_date: string | null;
  discipleship_stage_id: string | null;
  mentor_id: string | null;
  is_active: boolean;
  user_id: string | null;
  converted_at: string | null;
  created_at: string;
  archived_at: string | null;
  membership_status_name: string | null;
  baptism_status_name: string | null;
  discipleship_stage_name: string | null;
  mentor_name: string | null;
  cell_group_id: string | null;
  cell_group_name: string | null;
  cell_leader_name: string | null;
  ministry_ids: string[];
  ministry_names: string[];
  first_visit_date: string | null;
  visitor_status: VisitorStatus | null;
  invited_by_person_id: string | null;
  invited_by: string | null;
  visit_attendance_type_id: string | null;
  service_attended: string | null;
  prayer_request: string | null;
  visitor_notes: string | null;
};

export type ChurchSettings = {
  church_name: string;
  church_address: string | null;
  contact_number: string | null;
  email: string | null;
  timezone: string;
  date_format: string;
  member_id_prefix: string;
  member_id_padding: number;
  absence_threshold: number;
  track_individual_giving: boolean;
};

export type AttendanceSession = {
  id: string;
  attendance_type_id: string;
  title: string;
  session_date: string;
  cell_group_id: string | null;
  event_id: string | null;
  notes: string | null;
  archived_at: string | null;
  attendance_type: { name: string } | null;
  cell_group: { name: string } | null;
};

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };
