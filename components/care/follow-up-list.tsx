import Link from "next/link";
import { Check, Pencil } from "lucide-react";
import { saveFollowUp, setFollowUpStatus } from "@/app/(app)/module-actions";
import { ListEmpty } from "@/components/shared/blocks";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog, type FieldDef, type FormValues } from "@/components/shared/entity-dialog";
import { StatusPill } from "@/components/shared/person-avatar";
import { FOLLOW_UP_STATUSES, FOLLOW_UP_TYPES, labelOf, PRIORITIES, type SelectOption } from "@/lib/data/options";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

/** A row of the `follow_up_details` view. */
export type FollowUpRow = {
  id: string;
  person_id: string;
  person_name: string | null;
  person_type: "member" | "visitor" | null;
  follow_up_type: string;
  reason: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  priority: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  completed_at: string | null;
  source: string;
  due_state: "closed" | "no_date" | "overdue" | "today" | "upcoming";
};

export function followUpFields(people: SelectOption[], users: SelectOption[]): FieldDef[] {
  return [
    { name: "person_id", label: "Person", type: "select", options: people, emptyLabel: "Choose a person…", required: true, wide: true },
    { name: "follow_up_type", label: "Follow-up type", type: "select", options: [...FOLLOW_UP_TYPES] },
    { name: "priority", label: "Priority", type: "select", options: [...PRIORITIES] },
    { name: "assigned_to", label: "Assigned to", type: "select", options: users, emptyLabel: "Unassigned" },
    { name: "due_date", label: "Due date", type: "date" },
    { name: "status", label: "Status", type: "select", options: [...FOLLOW_UP_STATUSES] },
    { name: "reason", label: "Reason", type: "text", wide: true },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
}

export const followUpValues = (row?: Partial<FollowUpRow>): FormValues => ({
  person_id: row?.person_id ?? "",
  follow_up_type: row?.follow_up_type ?? "call",
  priority: row?.priority ?? "normal",
  assigned_to: row?.assigned_to ?? "",
  due_date: row?.due_date ?? "",
  status: row?.status ?? "pending",
  reason: row?.reason ?? "",
  notes: row?.notes ?? "",
});

const PRIORITY_TONE = { low: "neutral", normal: "neutral", high: "warning", urgent: "danger" } as const;

export function FollowUpRows({
  rows,
  dateFormat,
  edit,
}: {
  rows: FollowUpRow[];
  dateFormat: string;
  /** Pass the pickers to allow editing; omit for a read-only list. */
  edit?: { people: SelectOption[]; users: SelectOption[] };
}) {
  return (
    <ul className="divide-y">
      {rows.map((row) => {
        const open = row.status === "pending" || row.status === "in_progress";
        const profile = row.person_type === "visitor" ? "visitors" : "members";
        return (
          <li key={row.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {row.person_name ? (
                  <Link href={`/people/${profile}/${row.person_id}`} className="hover:underline">
                    {row.person_name}
                  </Link>
                ) : (
                  "Someone you don't have access to"
                )}
                <span className="ml-2 font-normal text-muted-foreground">{labelOf(FOLLOW_UP_TYPES, row.follow_up_type)}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[row.reason, row.assigned_to_name ? `Assigned to ${row.assigned_to_name}` : "Unassigned"].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {row.due_state === "overdue" ? (
                <StatusPill tone="danger">Overdue · {formatDate(row.due_date, dateFormat)}</StatusPill>
              ) : row.due_state === "today" ? (
                <StatusPill tone="warning">Due today</StatusPill>
              ) : row.due_state === "upcoming" ? (
                <StatusPill>Due {formatDate(row.due_date, dateFormat)}</StatusPill>
              ) : null}
              {open && row.priority !== "normal" ? (
                <StatusPill tone={PRIORITY_TONE[row.priority as keyof typeof PRIORITY_TONE] ?? "neutral"}>
                  {labelOf(PRIORITIES, row.priority)}
                </StatusPill>
              ) : null}
              <StatusPill tone={row.status === "completed" ? "success" : row.status === "in_progress" ? "brand" : "neutral"}>
                {labelOf(FOLLOW_UP_STATUSES, row.status)}
                {row.completed_at ? ` ${formatDate(row.completed_at, dateFormat)}` : ""}
              </StatusPill>
              {open ? (
                <ConfirmButton
                  action={setFollowUpStatus.bind(null, row.id, "completed")}
                  title="Mark this follow-up as completed?"
                  description="It stays in the history with today's date as its completion date."
                  confirmLabel="Mark completed"
                  successMessage="Follow-up completed"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Mark completed"
                >
                  <Check />
                </ConfirmButton>
              ) : null}
              {edit ? (
                <EntityDialog
                  title="Follow-up"
                  description="Change the details, reassign it, or update its status."
                  fields={followUpFields(edit.people, edit.users)}
                  initial={followUpValues(row)}
                  action={saveFollowUp.bind(null, row.id)}
                  successMessage="Follow-up updated"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="View or edit follow-up"
                >
                  <Pencil />
                </EntityDialog>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Follow-ups for a set of people, e.g. on a cell group or member page. */
export async function FollowUpList({
  personIds,
  openOnly = false,
  dateFormat,
  empty,
}: {
  personIds: string[];
  openOnly?: boolean;
  dateFormat: string;
  empty: string;
}) {
  if (personIds.length === 0) {
    return <ListEmpty>{empty}</ListEmpty>;
  }
  const supabase = await createClient();
  let query = supabase.from("follow_up_details").select("*").in("person_id", personIds);
  if (openOnly) query = query.in("status", ["pending", "in_progress"]);
  const { data } = await query.order("due_date", { ascending: true, nullsFirst: false }).limit(50);
  const rows = (data ?? []) as FollowUpRow[];

  return rows.length === 0 ? <ListEmpty>{empty}</ListEmpty> : <FollowUpRows rows={rows} dateFormat={dateFormat} />;
}
