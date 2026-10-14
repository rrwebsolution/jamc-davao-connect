import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, CalendarPlus, Pencil, Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import {
  addGroupMember,
  removeApprentice,
  removeGroupMember,
  saveApprentice,
  saveGroup,
  setGroupArchived,
} from "@/app/(app)/module-actions";
import { SessionDialog } from "@/components/attendance/session-dialog";
import { FollowUpList } from "@/components/care/follow-up-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackLink, Detail, formatTime, ListEmpty, Panel, StatTile } from "@/components/shared/blocks";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog, type FormValues } from "@/components/shared/entity-dialog";
import { StatusPill } from "@/components/shared/person-avatar";
import { PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, getChurchToday, getLookup, isUuid } from "@/lib/data/common";
import { groupFields, type GroupRow } from "@/lib/data/groups";
import { APPRENTICE_STATUSES, APPRENTICE_TRACKS, getPeopleOptions, labelOf } from "@/lib/data/options";
import { formatDate, titleCase } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Cell group" };

type Stats = {
  total_members: number;
  new_members: number;
  sessions: number;
  average_attendance: number | null;
  last_absentees: number;
  visitors: number;
  apprentices: number;
  potential_leaders: number;
};

async function GroupContent({ params }: Pick<PageProps<"/groups/[id]">, "params">) {
  const access = await requireAccess();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const { data: groupRow } = await supabase.from("cell_group_directory").select("*").eq("id", id).maybeSingle();
  const group = groupRow as GroupRow | null;
  // RLS hides groups the user has no connection to.
  if (!group) notFound();

  const canManage = can(access, P.groupsManage);
  const leadsThis = access.personId !== null && [group.leader_id, group.assistant_leader_id].includes(access.personId);
  const canEditDetails = canManage || (leadsThis && can(access, "groups.manage_assigned"));
  const canRecord = can(access, P.attendanceCreate) || (leadsThis && can(access, P.attendanceManageAssigned));
  const canSeeFollowUps = can(access, "care.view", "care.view_assigned");

  const [stats, members, sessions, visitors, apprentices, memberOptions, types, settings, today] = await Promise.all([
    supabase.rpc("cell_group_stats", { target_group_id: id }),
    supabase
      .from("people_directory")
      .select("id, full_name, member_code, contact_number, discipleship_stage_name, is_active")
      .eq("cell_group_id", id)
      .is("archived_at", null)
      .order("full_name"),
    supabase
      .from("attendance_sessions")
      .select("id, title, session_date")
      .eq("cell_group_id", id)
      .is("archived_at", null)
      .order("session_date", { ascending: false })
      .limit(12),
    supabase
      .from("attendance_record_details")
      .select("person_id, person_name, session_date")
      .eq("cell_group_id", id)
      .eq("person_type", "visitor")
      .order("session_date", { ascending: false })
      .limit(200),
    supabase.from("apprentices").select("*, person:people(full_name)").eq("cell_group_id", id).order("created_at"),
    canManage ? getPeopleOptions("member") : [],
    getLookup("attendance_types"),
    getChurchSettings(),
    getChurchToday(),
  ]);
  const s = (stats.data ?? {}) as Partial<Stats>;
  const memberRows = members.data ?? [];
  const memberIds = memberRows.map((row) => row.id);
  const notInGroup = memberOptions.filter((option) => !memberIds.includes(option.value));
  const inGroupOptions = memberRows.map((row) => ({ value: row.id, label: row.full_name }));

  // One line per visitor: their latest visit to this group.
  const visitorRows = [...new Map((visitors.data ?? []).map((row) => [row.person_id, row])).values()].reverse();

  let totals: Record<string, { present: number; total: number }> = {};
  if ((sessions.data ?? []).length > 0) {
    const { data: totalRows } = await supabase.rpc("attendance_session_totals", {
      session_ids: (sessions.data ?? []).map((row) => row.id),
    });
    totals = Object.fromEntries(
      ((totalRows ?? []) as { session_id: string; present: number; total: number }[]).map((row) => [
        row.session_id,
        { present: Number(row.present), total: Number(row.total) },
      ]),
    );
  }

  const groupValues: FormValues = {
    name: group.name,
    description: group.description ?? "",
    leader_id: group.leader_id ?? "",
    assistant_leader_id: group.assistant_leader_id ?? "",
    meeting_day: group.meeting_day ?? "",
    meeting_time: group.meeting_time?.slice(0, 5) ?? "",
    location: group.location ?? "",
    is_active: group.is_active,
  };
  const apprenticeFields = [
    { name: "person_id", label: "Member", type: "select" as const, options: inGroupOptions, emptyLabel: "Choose a member…", required: true },
    { name: "track", label: "Being prepared as", type: "select" as const, options: [...APPRENTICE_TRACKS] },
    { name: "status", label: "Status", type: "select" as const, options: [...APPRENTICE_STATUSES] },
    { name: "notes", label: "Notes", type: "textarea" as const },
  ];

  return (
    <>
      <BackLink href="/groups">Back to cell groups</BackLink>

      <div className="mb-4 flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold sm:text-2xl">{group.name}</h1>
            {group.archived_at ? (
              <StatusPill tone="danger">Archived</StatusPill>
            ) : group.is_active ? (
              <StatusPill tone="success">Active</StatusPill>
            ) : (
              <StatusPill>Inactive</StatusPill>
            )}
          </div>
          {group.description ? <p className="mt-1 text-sm text-muted-foreground">{group.description}</p> : null}
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Leader">{group.leader_name}</Detail>
            <Detail label="Assistant leader">{group.assistant_leader_name}</Detail>
            <Detail label="Meets">
              {[group.meeting_day ? `${titleCase(group.meeting_day)}s` : null, formatTime(group.meeting_time)].filter(Boolean).join(", ")}
            </Detail>
            <Detail label="Location">{group.location}</Detail>
          </dl>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canEditDetails && !group.archived_at ? (
            <EntityDialog
              title="Edit cell group"
              fields={groupFields(memberOptions, canManage)}
              initial={groupValues}
              action={saveGroup.bind(null, group.id)}
              successMessage="Cell group updated"
              variant="outline"
            >
              <Pencil /> Edit
            </EntityDialog>
          ) : null}
          {canManage ? (
            <ConfirmButton
              action={setGroupArchived.bind(null, group.id, !group.archived_at)}
              title={group.archived_at ? "Restore this cell group?" : "Archive this cell group?"}
              description={
                group.archived_at
                  ? "The group becomes active again."
                  : "The group is hidden from lists and its leaders lose their group access. Members and history are kept."
              }
              confirmLabel={group.archived_at ? "Restore" : "Archive"}
              successMessage={group.archived_at ? "Cell group restored" : "Cell group archived"}
              destructive={!group.archived_at}
              variant="outline"
            >
              {group.archived_at ? <ArchiveRestore /> : <Archive />}
              {group.archived_at ? "Restore" : "Archive"}
            </ConfirmButton>
          ) : null}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Members" value={s.total_members ?? 0} note={`${s.new_members ?? 0} joined in the last 30 days`} />
        <StatTile
          label="Average attendance"
          value={s.average_attendance ?? "—"}
          note={s.sessions ? `Over the last ${s.sessions} ${s.sessions === 1 ? "meeting" : "meetings"}` : "No meetings recorded yet"}
        />
        <StatTile label="Absent last meeting" value={s.last_absentees ?? 0} note={`${s.visitors ?? 0} visitors so far`} />
        <StatTile label="Apprentices" value={s.apprentices ?? 0} note={`${s.potential_leaders ?? 0} ready to lead`} />
      </div>

      <Tabs defaultValue="members">
        <div className="overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="visitors">Visitors</TabsTrigger>
            {canSeeFollowUps ? <TabsTrigger value="follow-ups">Follow-ups</TabsTrigger> : null}
            <TabsTrigger value="apprentices">Apprentices</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="members">
          <Panel
            title="Members"
            flush
            actions={
              canManage && !group.archived_at ? (
                <EntityDialog
                  title="Add a member"
                  description="A member belongs to one cell group at a time. Adding them here moves them out of their current group and keeps that as history."
                  fields={[{ name: "person_id", label: "Member", type: "select", options: notInGroup, emptyLabel: "Choose a member…", required: true }]}
                  initial={{ person_id: "" }}
                  action={async (values) => {
                    "use server";
                    return addGroupMember(id, String(values.person_id));
                  }}
                  submitLabel="Add to group"
                  successMessage="Member added"
                  size="sm"
                >
                  <UserPlus /> Add member
                </EntityDialog>
              ) : null
            }
          >
            {memberRows.length === 0 ? (
              <ListEmpty>No members in this group yet.</ListEmpty>
            ) : (
              <ul className="scroll-list divide-y">
                {memberRows.map((member) => (
                  <li key={member.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <Link href={`/people/members/${member.id}`} className="block truncate text-sm font-medium hover:underline">
                        {member.full_name}
                        {member.id === group.leader_id ? <span className="ml-2 text-xs font-normal text-muted-foreground">Leader</span> : null}
                        {member.id === group.assistant_leader_id ? <span className="ml-2 text-xs font-normal text-muted-foreground">Assistant</span> : null}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {[member.member_code, member.contact_number, member.discipleship_stage_name].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {canEditDetails && !group.archived_at ? (
                      <ConfirmButton
                        action={removeGroupMember.bind(null, id, member.id)}
                        title={`Remove ${member.full_name} from this group?`}
                        description="They stay a church member. Their time in this group is kept as history."
                        confirmLabel="Remove"
                        successMessage="Member removed from the group"
                        destructive
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${member.full_name}`}
                      >
                        <UserMinus />
                      </ConfirmButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="attendance">
          <Panel
            title="Group attendance"
            description="The last 12 meetings."
            flush
            actions={
              canRecord && !group.archived_at ? (
                <SessionDialog
                  types={types}
                  groups={[{ id: group.id, name: group.name }]}
                  groupRequired
                  today={today}
                  size="sm"
                  trigger={
                    <>
                      <CalendarPlus /> Record a meeting
                    </>
                  }
                />
              ) : null
            }
          >
            {(sessions.data ?? []).length === 0 ? (
              <ListEmpty>No meetings recorded for this group yet.</ListEmpty>
            ) : (
              <ul className="scroll-list divide-y">
                {(sessions.data ?? []).map((session) => (
                  <li key={session.id}>
                    <Link href={`/attendance/services/${session.id}`} className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-accent">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{session.title}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(session.session_date, settings.date_format)}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {totals[session.id] ? `${totals[session.id].present} of ${totals[session.id].total} present` : "Not recorded"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="visitors">
          <Panel title="Visitors" description="Visitors recorded at this group's meetings." flush>
            {visitorRows.length === 0 ? (
              <ListEmpty>No visitors have been recorded at this group&apos;s meetings.</ListEmpty>
            ) : (
              <ul className="scroll-list divide-y">
                {visitorRows.map((visitor) => (
                  <li key={visitor.person_id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <Link href={`/people/visitors/${visitor.person_id}`} className="truncate font-medium hover:underline">
                      {visitor.person_name}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">Last came {formatDate(visitor.session_date, settings.date_format)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>

        {canSeeFollowUps ? (
          <TabsContent value="follow-ups">
            <Panel title="Follow-ups" description="Open follow-ups for this group's members." flush>
              <FollowUpList personIds={memberIds} openOnly dateFormat={settings.date_format} empty="No open follow-ups for this group." />
            </Panel>
          </TabsContent>
        ) : null}

        <TabsContent value="apprentices">
          <Panel
            title="Apprentices"
            description="Members being prepared to lead."
            flush
            actions={
              canManage && !group.archived_at ? (
                <EntityDialog
                  title="Add an apprentice"
                  fields={apprenticeFields}
                  initial={{ person_id: "", track: "cell_leader", status: "active", notes: "" }}
                  action={saveApprentice.bind(null, id, null)}
                  successMessage="Apprentice added"
                  size="sm"
                >
                  <Plus /> Add apprentice
                </EntityDialog>
              ) : null
            }
          >
            {(apprentices.data ?? []).length === 0 ? (
              <ListEmpty>No apprentices in this group yet.</ListEmpty>
            ) : (
              <ul className="scroll-list divide-y">
                {(apprentices.data ?? []).map((row) => {
                  const person = row.person as { full_name: string } | null;
                  return (
                    <li key={row.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{person?.full_name ?? "Member"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {labelOf(APPRENTICE_TRACKS, row.track)} · since {formatDate(row.started_at, settings.date_format)}
                          {row.notes ? ` · ${row.notes}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <StatusPill tone={row.status === "ready" ? "success" : row.status === "paused" ? "neutral" : "brand"}>
                          {labelOf(APPRENTICE_STATUSES, row.status)}
                        </StatusPill>
                        {canManage ? (
                          <>
                            <EntityDialog
                              title="Edit apprentice"
                              fields={apprenticeFields}
                              initial={{ person_id: row.person_id, track: row.track, status: row.status, notes: row.notes ?? "" }}
                              action={saveApprentice.bind(null, id, row.id)}
                              successMessage="Apprentice updated"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Edit apprentice"
                            >
                              <Pencil />
                            </EntityDialog>
                            <ConfirmButton
                              action={removeApprentice.bind(null, row.id)}
                              title="Remove this apprentice?"
                              description="Only the apprentice entry is removed. The member is not affected."
                              confirmLabel="Remove"
                              successMessage="Apprentice removed"
                              destructive
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Remove apprentice"
                            >
                              <Trash2 />
                            </ConfirmButton>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function GroupPage({ params }: PageProps<"/groups/[id]">) {
  return (
    <PageBoundary fallback={<PageSkeleton variant="detail" />}>
      <GroupContent params={params} />
    </PageBoundary>
  );
}
