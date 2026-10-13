import { z } from "zod";
import { HEX_COLOR } from "@/lib/theme";

// Shared by the forms (client) and the Server Actions (server). The database
// constraints and RLS remain the last line of defence.

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

const optionalUuid = z
  .string()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null)
  .refine((value) => value === null || z.string().uuid().safeParse(value).success, "Invalid selection");

const optionalDate = z
  .string()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null)
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), "Enter a valid date");

const optionalEmail = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null)
  .refine((value) => value === null || z.string().email().safeParse(value).success, "Enter a valid email address");

const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const today = () => new Date(Date.now() + 14 * 3600 * 1000).toISOString().slice(0, 10);
const notInFuture = (value: string | null) => value === null || value <= today();

// --- Auth -------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});

export const passwordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: "The passwords don't match",
  });

// --- People -----------------------------------------------------------------

const personBase = {
  first_name: z.string().trim().min(1, "First name is required").max(80),
  middle_name: optionalText(80),
  last_name: z.string().trim().min(1, "Last name is required").max(80),
  nickname: optionalText(80),
  gender: z.enum(["male", "female", ""]).transform((value) => value || null),
  birthdate: optionalDate.refine(notInFuture, "Birthdate can't be in the future"),
  civil_status: z
    .enum(["single", "married", "widowed", "separated", ""])
    .transform((value) => value || null),
  contact_number: optionalText(40),
  email: optionalEmail,
  address: optionalText(300),
  photo_path: optionalText(300),
};

export const memberSchema = z.object({
  ...personBase,
  date_first_attended: optionalDate,
  membership_date: optionalDate,
  membership_status_id: optionalUuid,
  baptism_status_id: optionalUuid,
  baptism_date: optionalDate,
  discipleship_stage_id: optionalUuid,
  mentor_id: optionalUuid,
  cell_group_id: optionalUuid,
  ministry_id: optionalUuid,
  is_active: z.boolean(),
});

export const visitorSchema = z.object({
  ...personBase,
  first_visit_date: requiredDate,
  invited_by_name: optionalText(120),
  attendance_type_id: optionalUuid,
  prayer_request: optionalText(1000),
  notes: optionalText(1000),
  status: z.enum([
    "new",
    "contacted",
    "follow_up_scheduled",
    "returning",
    "connected_to_cell_group",
    "became_member",
  ]),
});

export const ownContactSchema = z.object({
  nickname: optionalText(80),
  contact_number: optionalText(40),
  email: optionalEmail,
  address: optionalText(300),
});

// --- Attendance -------------------------------------------------------------

export const sessionSchema = z.object({
  attendance_type_id: z.string().uuid("Choose a service or event type"),
  title: z.string().trim().min(1, "Give this session a name").max(120),
  session_date: requiredDate,
  cell_group_id: optionalUuid,
  notes: optionalText(500),
});

export const attendanceMarksSchema = z.object({
  session_id: z.string().uuid(),
  marks: z
    .array(z.object({ person_id: z.string().uuid(), status_id: z.string().uuid().nullable() }))
    .max(2000),
});

// --- Settings ---------------------------------------------------------------

export const generalSettingsSchema = z.object({
  church_name: z.string().trim().min(1, "Church name is required").max(120),
  church_address: optionalText(300),
  contact_number: optionalText(40),
  email: optionalEmail,
  timezone: z.string().trim().min(1).max(60),
  date_format: z.enum(["MMM d, yyyy", "MM/dd/yyyy", "dd/MM/yyyy", "yyyy-MM-dd"]),
});

export const membershipSettingsSchema = z.object({
  member_id_prefix: z.string().trim().max(12, "Keep the prefix under 12 characters"),
  member_id_padding: z.coerce.number().int().min(3).max(10),
});

export const attendanceSettingsSchema = z.object({
  absence_threshold: z.coerce.number().int().min(1, "At least 1").max(52, "At most 52"),
});

const hex = z.string().regex(HEX_COLOR, "Use a 6-digit HEX colour, like #7C2D12");

export const appearanceSchema = z.object({
  system_name: z.string().trim().min(1, "System name is required").max(80),
  system_short_name: z.string().trim().min(1, "Short name is required").max(30),
  tagline: z.string().trim().max(120),
  logo_path: optionalText(300),
  login_logo_path: optionalText(300),
  login_logo_dark_path: optionalText(300),
  favicon_path: optionalText(300),
  login_background_path: optionalText(300),
  logo_size: z.coerce.number().int().min(20).max(48),
  login_logo_size: z.coerce.number().int().min(32).max(160),
  primary_color: hex,
  secondary_color: hex,
  accent_color: hex,
  sidebar_background_color: hex,
  sidebar_text_color: hex,
  navbar_color: hex,
  background_color: hex,
  card_color: hex,
  button_color: hex,
  button_text_color: hex,
  link_color: hex,
  default_theme: z.enum(["light", "dark", "system"]),
  allow_user_theme_override: z.boolean(),
});

export const lookupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: optionalText(300),
  is_active: z.boolean(),
  flag: z.boolean().optional(),
});

// --- Users & roles ----------------------------------------------------------

export const newUserSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters").max(72),
  role_id: z.string().uuid("Choose a role"),
  person_id: optionalUuid,
});

export const roleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  description: optionalText(200),
});

// --- Cell groups ------------------------------------------------------------

const optionalTime = z
  .string()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null)
  .refine((value) => value === null || /^\d{2}:\d{2}(:\d{2})?$/.test(value), "Enter a valid time");

const amount = z.coerce
  .number({ invalid_type_error: "Enter an amount" })
  .positive("Enter an amount greater than zero")
  .max(999_999_999, "That amount is too large")
  .transform((value) => Math.round(value * 100) / 100);

const requiredUuid = (message: string) => z.string().uuid(message);

export const groupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(80),
  description: optionalText(500),
  leader_id: optionalUuid,
  assistant_leader_id: optionalUuid,
  meeting_day: z
    .enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", ""])
    .transform((value) => value || null),
  meeting_time: optionalTime,
  location: optionalText(200),
  is_active: z.boolean(),
});

export const apprenticeSchema = z.object({
  person_id: requiredUuid("Choose a person"),
  track: z.enum(["cell_leader", "ministry_leader", "mentor"]),
  status: z.enum(["active", "ready", "graduated", "paused"]),
  notes: optionalText(500),
});

// --- Care -------------------------------------------------------------------

export const followUpSchema = z.object({
  person_id: requiredUuid("Choose a person"),
  follow_up_type: z.enum([
    "call", "message", "home_visit", "prayer", "encouragement",
    "pastoral_conversation", "visitor_follow_up", "absentee_follow_up", "other",
  ]),
  reason: optionalText(500),
  assigned_to: optionalUuid,
  priority: z.enum(["low", "normal", "high", "urgent"]),
  due_date: optionalDate,
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  notes: optionalText(2000),
});

export const pastoralCareSchema = z.object({
  person_id: requiredUuid("Choose a person"),
  care_type: z.enum([
    "counseling", "prayer", "hospital_visit", "home_visit", "bereavement",
    "marriage_family", "spiritual_guidance", "encouragement", "other",
  ]),
  care_date: requiredDate,
  assigned_to: optionalUuid,
  summary: z.string().trim().min(1, "A short summary is required").max(300),
  notes: optionalText(5000),
  follow_up_required: z.boolean(),
  follow_up_date: optionalDate,
  confidentiality: z.enum(["pastor_only", "selected_leaders", "care_team"]),
  shared_with: z.array(z.string().uuid()).max(50).optional().default([]),
});

// --- Discipleship -----------------------------------------------------------

export const discipleshipSchema = z.object({
  stage_id: optionalUuid,
  mentor_id: optionalUuid,
  notes: optionalText(1000),
});

export const milestoneSchema = z.object({
  title: z.string().trim().min(1, "Describe the milestone").max(160),
  achieved_on: requiredDate,
  notes: optionalText(1000),
});

// --- Ministries -------------------------------------------------------------

export const ministrySchema = z.object({
  name: z.string().trim().min(1, "Ministry name is required").max(80),
  description: optionalText(500),
  leader_id: optionalUuid,
  assistant_leader_id: optionalUuid,
  is_active: z.boolean(),
});

export const ministryAssignmentSchema = z.object({
  person_id: requiredUuid("Choose a member"),
  role: optionalText(80),
  date_assigned: requiredDate,
  status: z.enum(["active", "inactive"]),
});

// --- Events -----------------------------------------------------------------

export const eventSchema = z
  .object({
    name: z.string().trim().min(1, "Event name is required").max(120),
    description: optionalText(2000),
    event_type: z.enum([
      "sunday_service", "prayer_meeting", "cell_meeting", "church_event",
      "outreach", "training", "fellowship", "other",
    ]),
    event_date: requiredDate,
    start_time: optionalTime,
    end_time: optionalTime,
    venue: optionalText(200),
    organizer: optionalText(120),
    status: z.enum(["upcoming", "ongoing", "completed", "cancelled"]),
  })
  .refine((value) => !value.start_time || !value.end_time || value.end_time >= value.start_time, {
    path: ["end_time"],
    message: "The end time is before the start time",
  });

// --- Finance ----------------------------------------------------------------

export const givingSchema = z.object({
  giving_date: requiredDate,
  category_id: requiredUuid("Choose a category"),
  amount,
  payment_method_id: requiredUuid("Choose a payment method"),
  financial_account_id: requiredUuid("Choose the account that received it"),
  reference_number: optionalText(80),
  check_number: optionalText(40),
  check_bank: optionalText(80),
  check_date: optionalDate,
  proof_path: optionalText(200),
  notes: optionalText(500),
  donor_person_id: optionalUuid,
});

export const expenseSchema = z.object({
  expense_date: requiredDate,
  category_id: requiredUuid("Choose a category"),
  description: z.string().trim().min(1, "Describe the expense").max(200),
  amount,
  payment_method_id: requiredUuid("Choose a payment method"),
  financial_account_id: requiredUuid("Choose the account it was paid from"),
  payee: optionalText(120),
  reference_number: optionalText(80),
  notes: optionalText(500),
});

export const paymentMethodSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  kind: z.enum(["cash", "e_wallet", "bank", "check", "other"]),
  requires_reference: z.boolean(),
  is_active: z.boolean(),
});

export const financialAccountSchema = z.object({
  name: z.string().trim().min(1, "Account name is required").max(80),
  account_type: z.enum(["cash", "e_wallet", "bank", "other"]),
  provider: optionalText(80),
  account_holder: optionalText(120),
  account_number: optionalText(40),
  opening_balance: z.coerce.number({ invalid_type_error: "Enter an amount" }).min(-999_999_999).max(999_999_999).default(0),
  notes: optionalText(300),
  is_active: z.boolean(),
});

export const transferSchema = z
  .object({
    from_account_id: requiredUuid("Choose the account the money leaves"),
    to_account_id: requiredUuid("Choose the account the money goes to"),
    amount,
    transfer_date: requiredDate,
    reference_number: optionalText(80),
    notes: optionalText(500),
  })
  .refine((value) => value.from_account_id !== value.to_account_id, {
    path: ["to_account_id"],
    message: "Choose two different accounts",
  });

export type MemberInput = z.input<typeof memberSchema>;
export type VisitorInput = z.input<typeof visitorSchema>;
export type SessionInput = z.input<typeof sessionSchema>;
export type AppearanceInput = z.input<typeof appearanceSchema>;
