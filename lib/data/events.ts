import "server-only";
import type { FieldDef, FormValues } from "@/components/shared/entity-dialog";
import { EVENT_STATUSES, EVENT_TYPES } from "@/lib/data/options";

/** A row of the `event_directory` view. */
export type EventRow = {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  organizer: string | null;
  status: "upcoming" | "ongoing" | "completed" | "cancelled";
  archived_at: string | null;
  session_id: string | null;
  attendance_count: number;
};

export const EVENT_FIELDS: FieldDef[] = [
  { name: "name", label: "Event name", type: "text", required: true, wide: true },
  { name: "event_type", label: "Event type", type: "select", options: [...EVENT_TYPES] },
  { name: "status", label: "Status", type: "select", options: [...EVENT_STATUSES] },
  { name: "event_date", label: "Date", type: "date", required: true },
  { name: "venue", label: "Venue", type: "text" },
  { name: "start_time", label: "Start time", type: "time" },
  { name: "end_time", label: "End time", type: "time" },
  { name: "organizer", label: "Organizer", type: "text", wide: true },
  { name: "description", label: "Description", type: "textarea" },
];

export const eventValues = (event: Partial<EventRow> | null, today: string): FormValues => ({
  name: event?.name ?? "",
  event_type: event?.event_type ?? "church_event",
  status: event?.status ?? "upcoming",
  event_date: event?.event_date ?? today,
  venue: event?.venue ?? "",
  start_time: event?.start_time?.slice(0, 5) ?? "",
  end_time: event?.end_time?.slice(0, 5) ?? "",
  organizer: event?.organizer ?? "",
  description: event?.description ?? "",
});

export const EVENT_TONE = { upcoming: "brand", ongoing: "success", completed: "neutral", cancelled: "danger" } as const;
