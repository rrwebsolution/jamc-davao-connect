import "server-only";
import type { FieldDef } from "@/components/shared/entity-dialog";
import { WEEKDAYS, type SelectOption } from "@/lib/data/options";

/** A row of the `cell_group_directory` view. */
export type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  leader_id: string | null;
  assistant_leader_id: string | null;
  leader_name: string | null;
  assistant_leader_name: string | null;
  meeting_day: string | null;
  meeting_time: string | null;
  location: string | null;
  is_active: boolean;
  archived_at: string | null;
  member_count: number;
};

/** `full` = group managers; cell leaders may only edit the meeting details. */
export function groupFields(members: SelectOption[], full = true): FieldDef[] {
  const details: FieldDef[] = [
    { name: "meeting_day", label: "Meeting day", type: "select", options: [...WEEKDAYS], emptyLabel: "Not set" },
    { name: "meeting_time", label: "Meeting time", type: "time" },
    { name: "location", label: "Meeting location", type: "text", wide: true },
    { name: "description", label: "Description", type: "textarea" },
  ];
  if (!full) return details;
  return [
    { name: "name", label: "Group name", type: "text", required: true, wide: true },
    { name: "leader_id", label: "Leader", type: "select", options: members, emptyLabel: "No leader yet" },
    { name: "assistant_leader_id", label: "Assistant leader", type: "select", options: members, emptyLabel: "None" },
    ...details,
    { name: "is_active", label: "Active", type: "switch", hint: "Inactive groups are kept but not offered when assigning members." },
  ];
}
