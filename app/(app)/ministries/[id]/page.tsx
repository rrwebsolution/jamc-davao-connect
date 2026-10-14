import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Trash2, UserPlus } from "lucide-react";
import {
  removeMinistryAssignment,
  saveMinistry,
  saveMinistryAssignment,
  setMinistryArchived,
} from "@/app/(app)/module-actions";
import { BackLink, Detail, ListEmpty, Panel } from "@/components/shared/blocks";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog, type FieldDef } from "@/components/shared/entity-dialog";
import { StatusPill } from "@/components/shared/person-avatar";
import { NoAccess, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, getChurchToday, isUuid } from "@/lib/data/common";
import { getPeopleOptions } from "@/lib/data/options";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { MinistryRow } from "../page";

export const metadata: Metadata = { title: "Ministry" };

type AssignmentRow = {
  id: string;
  person_id: string;
  person_name: string;
  member_code: string | null;
  role: string | null;
  date_assigned: string;
  status: "active" | "inactive";
};

async function MinistryContent({ params }: Pick<PageProps<"/ministries/[id]">, "params">) {
  const access = await requireAccess();
  if (!can(access, P.ministriesView, P.ministriesManage)) {
    return <NoAccess />;
  }
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const canManage = can(access, P.ministriesManage);

  const supabase = await createClient();
  const [ministryResult, assignments, members, settings, today] = await Promise.all([
    supabase.from("ministry_directory").select("*").eq("id", id).maybeSingle(),
    supabase.from("ministry_member_details").select("*").eq("ministry_id", id).order("status").order("person_name"),
    canManage ? getPeopleOptions("member") : [],
    getChurchSettings(),
    getChurchToday(),
  ]);
  const ministry = ministryResult.data as MinistryRow | null;
  if (!ministry) notFound();
  const rows = (assignments.data ?? []) as AssignmentRow[];
  const assignedIds = rows.map((row) => row.person_id);

  const assignmentFields = (pickPerson: boolean): FieldDef[] => [
    ...(pickPerson
      ? [{
          name: "person_id",
          label: "Member",
          type: "select" as const,
          options: members.filter((option) => !assignedIds.includes(option.value)),
          emptyLabel: "Choose a member…",
          required: true,
          wide: true,
        }]
      : []),
    { name: "role", label: "Ministry role", type: "text", placeholder: "e.g. Vocalist, Camera operator" },
    { name: "date_assigned", label: "Date joined", type: "date", required: true },
    { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
  ];

  return (
    <>
      <BackLink href="/ministries">Back to ministries</BackLink>

      <div className="mb-4 flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold sm:text-2xl">{ministry.name}</h1>
            {ministry.archived_at ? (
              <StatusPill tone="danger">Archived</StatusPill>
            ) : ministry.is_active ? (
              <StatusPill tone="success">Active</StatusPill>
            ) : (
              <StatusPill>Inactive</StatusPill>
            )}
          </div>
          {ministry.description ? <p className="mt-1 text-sm text-muted-foreground">{ministry.description}</p> : null}
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Detail label="Leader">{ministry.leader_name}</Detail>
            <Detail label="Assistant leader">{ministry.assistant_leader_name}</Detail>
            <Detail label="Members serving">{String(ministry.member_count)}</Detail>
          </dl>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {!ministry.archived_at ? (
              <EntityDialog
                title="Edit ministry"
                fields={[
                  { name: "name", label: "Ministry name", type: "text", required: true, wide: true },
                  { name: "leader_id", label: "Leader", type: "select", options: members, emptyLabel: "No leader yet" },
                  { name: "assistant_leader_id", label: "Assistant leader", type: "select", options: members, emptyLabel: "None" },
                  { name: "description", label: "Description", type: "textarea" },
                  { name: "is_active", label: "Active", type: "switch" },
                ]}
                initial={{
                  name: ministry.name,
                  description: ministry.description ?? "",
                  leader_id: ministry.leader_id ?? "",
                  assistant_leader_id: ministry.assistant_leader_id ?? "",
                  is_active: ministry.is_active,
                }}
                action={saveMinistry.bind(null, ministry.id)}
                successMessage="Ministry updated"
                variant="outline"
              >
                <Pencil /> Edit
              </EntityDialog>
            ) : null}
            <ConfirmButton
              action={setMinistryArchived.bind(null, ministry.id, !ministry.archived_at)}
              title={ministry.archived_at ? "Restore this ministry?" : "Archive this ministry?"}
              description={
                ministry.archived_at
                  ? "The ministry becomes active again."
                  : "It will no longer be offered for new assignments. Existing assignments are kept as history."
              }
              confirmLabel={ministry.archived_at ? "Restore" : "Archive"}
              successMessage={ministry.archived_at ? "Ministry restored" : "Ministry archived"}
              destructive={!ministry.archived_at}
              variant="outline"
            >
              {ministry.archived_at ? <ArchiveRestore /> : <Archive />}
              {ministry.archived_at ? "Restore" : "Archive"}
            </ConfirmButton>
          </div>
        ) : null}
      </div>

      <Panel
        title="Ministry members"
        description="Who serves here, in what role, and since when."
        flush
        actions={
          canManage && !ministry.archived_at ? (
            <EntityDialog
              title="Assign a member"
              description="A member can serve in several ministries, but appears once in each."
              fields={assignmentFields(true)}
              initial={{ person_id: "", role: "", date_assigned: today, status: "active" }}
              action={saveMinistryAssignment.bind(null, id, null)}
              submitLabel="Assign"
              successMessage="Member assigned"
              size="sm"
            >
              <UserPlus /> Assign member
            </EntityDialog>
          ) : null
        }
      >
        {rows.length === 0 ? (
          <ListEmpty>No one is assigned to this ministry yet.</ListEmpty>
        ) : (
          <ul className="scroll-list divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <Link href={`/people/members/${row.person_id}`} className="block truncate text-sm font-medium hover:underline">
                    {row.person_name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {[row.role, `since ${formatDate(row.date_assigned, settings.date_format)}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {row.status === "inactive" ? <StatusPill>Inactive</StatusPill> : null}
                  {canManage ? (
                    <>
                      <EntityDialog
                        title={`${row.person_name} in ${ministry.name}`}
                        fields={assignmentFields(false)}
                        initial={{ person_id: row.person_id, role: row.role ?? "", date_assigned: row.date_assigned, status: row.status }}
                        action={saveMinistryAssignment.bind(null, id, row.id)}
                        successMessage="Assignment updated"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${row.person_name}'s assignment`}
                      >
                        <Pencil />
                      </EntityDialog>
                      <ConfirmButton
                        action={removeMinistryAssignment.bind(null, row.id)}
                        title={`Remove ${row.person_name} from ${ministry.name}?`}
                        description="To keep the history instead, edit the assignment and set it to Inactive."
                        confirmLabel="Remove"
                        successMessage="Assignment removed"
                        destructive
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${row.person_name}`}
                      >
                        <Trash2 />
                      </ConfirmButton>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export default function MinistryPage({ params }: PageProps<"/ministries/[id]">) {
  return (
    <PageBoundary fallback={<PageSkeleton variant="detail" />}>
      <MinistryContent params={params} />
    </PageBoundary>
  );
}
