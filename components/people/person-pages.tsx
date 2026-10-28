import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Cake, Heart, Mail, MapPin, Pencil, Phone, UserCheck, UserRound, UsersRound, type LucideIcon } from "lucide-react";
import { convertVisitor, setPersonArchived } from "@/app/(app)/people/actions";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttendanceSummary } from "@/components/attendance/attendance-summary";
import { AccountAccess, getMemberAccount } from "@/components/people/account-access";
import { FollowUpList } from "@/components/care/follow-up-list";
import { PersonForm } from "@/components/people/person-form";
import { VisitorStatusPill } from "@/components/people/visitor-status";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { PersonAvatar, StatusPill } from "@/components/shared/person-avatar";
import { RowMenu } from "@/components/shared/row-menu";
import { EmptyState, NoAccess, PageHeader } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, getChurchToday, getLookup, signPhotoUrls } from "@/lib/data/common";
import { getCellGroupOptions, getMemberOptions, getPerson } from "@/lib/data/people";
import { ageFrom, formatDate, formatDateTime, titleCase } from "@/lib/format";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { PersonType } from "@/lib/types";

const LIST = { member: "/people/members", visitor: "/people/visitors" } as const;

/** The add / edit screen for a member or visitor. */
export async function PersonFormPage({ mode, id }: { mode: PersonType; id?: string }) {
  const access = await requireAccess();
  const needed =
    mode === "member" ? (id ? P.membersUpdate : P.membersCreate) : id ? P.visitorsUpdate : P.visitorsCreate;
  if (!can(access, needed)) {
    return <NoAccess />;
  }

  const person = id ? await getPerson(id, mode) : null;
  if (id && !person) {
    notFound();
  }

  const [membershipStatuses, baptismStatuses, stages, ministries, attendanceTypes, cellGroups, mentors, today, photos] =
    await Promise.all([
      getLookup("membership_statuses"),
      getLookup("baptism_statuses"),
      getLookup("discipleship_stages"),
      getLookup("ministries"),
      getLookup("attendance_types"),
      mode === "member" ? getCellGroupOptions() : [],
      getMemberOptions(),
      getChurchToday(),
      signPhotoUrls([person?.photo_path]),
    ]);

  // "Create a user account for this member": only offered to people who manage users.
  let accountRoles: { id: string; key: string; name: string }[] | null = null;
  if (mode === "member" && !person && isAdminConfigured && can(access, P.usersManage)) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("assignable_roles");
    accountRoles = (data ?? []) as { id: string; key: string; name: string }[];
  }

  const noun = mode === "member" ? "member" : "visitor";
  return (
    <>
      <PageHeader
        title={person ? `Edit ${person.full_name}` : mode === "member" ? "Add member" : "Register visitor"}
        description={person ? undefined : `Fields marked * are required. You can add more details to this ${noun} later.`}
      />
      <PersonForm
        mode={mode}
        person={person}
        photoUrl={person?.photo_path ? (photos[person.photo_path] ?? null) : null}
        options={{ membershipStatuses, baptismStatuses, stages, ministries, attendanceTypes, cellGroups, mentors }}
        today={today}
        accountRoles={accountRoles}
      />
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children || "—"}</dd>
    </div>
  );
}

/** A personal detail with its icon: label above, value below. */
function IconDetail({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm break-words">{children || "—"}</dd>
      </div>
    </div>
  );
}

/** A label and value side by side, stacked on phones. */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="text-sm break-words">{children || "—"}</dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs sm:p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** "March 2020" from a date. */
function monthYear(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : null;
}

/** The profile screen for a member or visitor. */
export async function PersonProfilePage({
  mode,
  id,
  openAccountDialog = false,
}: {
  mode: PersonType;
  id: string;
  /** Open "Create User Account" at once: the member was saved but the account was not. */
  openAccountDialog?: boolean;
}) {
  const access = await requireAccess();
  const person = await getPerson(id, mode);
  if (!person) {
    // RLS hides people the user may not see, so "not found" covers both cases.
    notFound();
  }

  const isMember = mode === "member";
  const managesUsers = isMember && can(access, P.usersManage);
  const [settings, today, photos, account] = await Promise.all([
    getChurchSettings(),
    getChurchToday(),
    signPhotoUrls([person.photo_path]),
    managesUsers && person.user_id ? getMemberAccount(person.id) : null,
  ]);
  // Archiving must not leave a working login behind.
  const hasActiveAccount = Boolean(account?.is_active);
  const date = (value: string | null) => formatDate(value, settings.date_format);
  const age = ageFrom(person.birthdate, today);

  const canEdit = can(access, isMember ? P.membersUpdate : P.visitorsUpdate);
  const canArchive = isMember ? canEdit && can(access, P.membersArchive) : canEdit;
  const canConvert = !isMember && canEdit && can(access, P.membersCreate);
  const canSeeLogs = can(access, P.logsView);
  const canSeeCare = can(access, "care.view", "care.view_assigned", "care.manage", "care.confidential");
  const canSeeAttendance =
    can(access, P.attendanceView, P.attendanceViewAssigned) || person.user_id === access.userId;

  let logs: { id: string; description: string; created_at: string }[] = [];
  if (canSeeLogs) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("activity_logs")
      .select("id, description, created_at")
      .eq("module", "people")
      .eq("record_id", person.id)
      .order("created_at", { ascending: false })
      .limit(20);
    logs = data ?? [];
  }

  const personal = (
    <section className="p-4 sm:p-5">
      <h2 className="mb-4 text-base font-semibold">Personal information</h2>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <IconDetail icon={UserRound} label="Full name">
          {[person.first_name, person.middle_name, person.last_name, person.suffix].filter(Boolean).join(" ")}
          {person.nickname ? <span className="text-muted-foreground"> ({person.nickname})</span> : null}
        </IconDetail>
        <IconDetail icon={Cake} label="Birthdate">
          {person.birthdate ? `${date(person.birthdate)}${age !== null ? ` (${age} years old)` : ""}` : null}
        </IconDetail>
        <IconDetail icon={UsersRound} label="Gender">{person.gender ? titleCase(person.gender) : null}</IconDetail>
        <IconDetail icon={Heart} label="Civil status">{person.civil_status ? titleCase(person.civil_status) : null}</IconDetail>
        <IconDetail icon={Phone} label="Contact number">{person.contact_number}</IconDetail>
        <IconDetail icon={Mail} label="Email">{person.email}</IconDetail>
        <div className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
          <IconDetail icon={MapPin} label="Address">{person.address}</IconDetail>
        </div>
      </dl>
    </section>
  );

  const visit = person.first_visit_date ? (
    <Panel title={isMember ? "First visit (before membership)" : "Visit details"}>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="First visit date">{date(person.first_visit_date)}</Detail>
        <Detail label="Service attended">{person.service_attended}</Detail>
        <Detail label="Invited by">
          {person.invited_by_person_id && person.invited_by ? (
            <Link href={`/people/members/${person.invited_by_person_id}`} className="text-link hover:underline">
              {person.invited_by}
            </Link>
          ) : (
            person.invited_by
          )}
        </Detail>
        <Detail label="Follow-up status">
          <VisitorStatusPill status={person.visitor_status} />
        </Detail>
        <div className="sm:col-span-2 lg:col-span-3">
          <Detail label="Prayer request">{person.prayer_request}</Detail>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Detail label="Notes">{person.visitor_notes}</Detail>
        </div>
      </dl>
    </Panel>
  ) : null;

  const church = (
    <section className="p-4 sm:p-5">
      <h2 className="mb-2 text-base font-semibold">Membership information</h2>
      <dl className="divide-y">
        <InfoRow label="Membership status">
          {person.membership_status_name ? <StatusPill tone="success">{person.membership_status_name}</StatusPill> : null}
        </InfoRow>
        <InfoRow label="Membership date">{date(person.membership_date)}</InfoRow>
        <InfoRow label="Date first attended">{date(person.date_first_attended)}</InfoRow>
        <InfoRow label="Baptism">
          {[person.baptism_status_name, person.baptism_date ? date(person.baptism_date) : null].filter(Boolean).join(" · ")}
        </InfoRow>
        <InfoRow label="Cell group">
          {person.cell_group_name ? <StatusPill tone="info">{person.cell_group_name}</StatusPill> : null}
        </InfoRow>
        <InfoRow label="Group leader">{person.cell_leader_name}</InfoRow>
        <InfoRow label="Mentor">{person.mentor_name}</InfoRow>
        <InfoRow label="Discipleship stage">{person.discipleship_stage_name}</InfoRow>
        <InfoRow label="Ministry involvement">
          {person.ministry_names.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {person.ministry_names.map((name) => (
                <StatusPill key={name} tone="brand">
                  {name}
                </StatusPill>
              ))}
            </span>
          ) : null}
        </InfoRow>
      </dl>
    </section>
  );

  return (
    <>
      <Link href={LIST[mode]} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Back to {isMember ? "members" : "visitors"}
      </Link>

      <Tabs defaultValue="overview">
        <div className="mb-4 rounded-xl border bg-card shadow-xs">
          <div className="flex flex-wrap items-start gap-4 p-4 sm:flex-nowrap sm:items-center sm:p-5">
            <PersonAvatar
              name={person.full_name}
              src={person.photo_path ? photos[person.photo_path] : null}
              className="size-14 text-lg sm:size-20 sm:text-xl"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1 className="min-w-0 truncate">{person.full_name}</h1>
                {person.archived_at ? (
                  <StatusPill tone="danger">Archived</StatusPill>
                ) : isMember ? (
                  person.is_active ? <StatusPill tone="success">Active member</StatusPill> : <StatusPill>Inactive member</StatusPill>
                ) : (
                  <VisitorStatusPill status={person.visitor_status} />
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                {isMember ? (
                  <>
                    {person.membership_date ? <span>Member since {monthYear(person.membership_date)}</span> : <span>Member</span>}
                    {person.member_code ? (
                      <>
                        <span aria-hidden className="text-border">|</span>
                        <span>
                          ID: <span className="font-mono">{person.member_code}</span>
                        </span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <span>Visitor · first visit {date(person.first_visit_date)}</span>
                )}
              </p>
              {isMember && person.discipleship_stage_name ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusPill tone="brand">{person.discipleship_stage_name}</StatusPill>
                </div>
              ) : null}
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:self-start">
              {canConvert && !person.archived_at ? (
                <ConfirmButton
                  action={convertVisitor.bind(null, person.id)}
                  title="Convert to member?"
                  description={`${person.full_name} will become a member. Their details, attendance and visit history stay on the same record.`}
                  confirmLabel="Convert to member"
                  successMessage={`${person.full_name} is now a member`}
                  redirectTo={`/people/members/${person.id}`}
                >
                  <UserCheck /> Convert to member
                </ConfirmButton>
              ) : null}
              {canEdit && !person.archived_at ? (
                <Link href={`${LIST[mode]}/${person.id}/edit`} className={buttonVariants({ variant: "outline" })}>
                  <Pencil /> Edit
                </Link>
              ) : null}
              {canArchive ? (
                <RowMenu
                  label={`More actions for ${person.full_name}`}
                  text="More"
                  items={[
                    {
                      label: person.archived_at ? "Restore" : "Archive",
                      icon: person.archived_at ? "restore" : "archive",
                      confirm: {
                        action: setPersonArchived.bind(null, person.id, !person.archived_at, hasActiveAccount),
                        title: person.archived_at
                          ? "Restore this record?"
                          : hasActiveAccount
                            ? "This member has an active system account."
                            : "Archive this record?",
                        description: person.archived_at
                          ? `${person.full_name} will appear in lists again.${account ? " Their account stays disabled until you reactivate it." : ""}`
                          : hasActiveAccount
                            ? `Archiving ${person.full_name} also disables their account, so they can no longer sign in. Nothing is deleted: attendance, discipleship, ministry and other history are kept, and both can be restored later.`
                            : `${person.full_name} will be hidden from lists and counts. Their history is kept and they can be restored at any time.`,
                        confirmLabel: person.archived_at ? "Restore" : hasActiveAccount ? "Archive Member and Disable Account" : "Archive",
                        successMessage: person.archived_at ? "Record restored" : "Record archived",
                        destructive: !person.archived_at,
                      },
                    },
                  ]}
                />
              ) : null}
            </div>
          </div>
          <div className="px-4 sm:px-5">
            <TabsList className="border-b-0">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              {canSeeAttendance ? <TabsTrigger value="attendance">Attendance</TabsTrigger> : null}
              {isMember ? <TabsTrigger value="discipleship">Discipleship</TabsTrigger> : null}
              {isMember ? <TabsTrigger value="ministries">Ministries</TabsTrigger> : null}
              {canSeeCare ? <TabsTrigger value="care">Pastoral Care</TabsTrigger> : null}
              {canSeeLogs ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
            </TabsList>
          </div>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <div className={`grid grid-cols-1 divide-y rounded-xl border bg-card shadow-xs ${isMember ? "lg:grid-cols-2 lg:divide-x lg:divide-y-0" : ""}`}>
            {personal}
            {isMember ? church : null}
          </div>
          {managesUsers ? (
            <AccountAccess
              person={person}
              account={account}
              currentUserId={access.userId}
              timezone={settings.timezone}
              autoOpen={openAccountDialog}
            />
          ) : null}
          {visit}
        </TabsContent>

        {canSeeAttendance ? (
          <TabsContent value="attendance">
            <AttendanceSummary personId={person.id} dateFormat={settings.date_format} threshold={settings.absence_threshold} />
          </TabsContent>
        ) : null}

        {isMember ? (
          <TabsContent value="discipleship">
            <Panel title="Discipleship">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Detail label="Current stage">{person.discipleship_stage_name}</Detail>
                <Detail label="Mentor">{person.mentor_name}</Detail>
              </dl>
              <p className="mt-4 text-sm">
                <Link href={`/discipleship/${person.id}`} className="text-link hover:underline">
                  Open the discipleship profile
                </Link>{" "}
                <span className="text-muted-foreground">for the growth path, stage history and milestones.</span>
              </p>
            </Panel>
          </TabsContent>
        ) : null}

        {isMember ? (
          <TabsContent value="ministries">
            <Panel title="Ministries">
              {person.ministry_names.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not serving in a ministry yet.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {person.ministry_names.map((name) => (
                    <li key={name}>
                      <StatusPill tone="brand">{name}</StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </TabsContent>
        ) : null}

        {canSeeCare ? (
          <TabsContent value="care" className="space-y-4">
            <section className="rounded-xl border bg-card shadow-xs">
              <h2 className="border-b p-4 text-base font-semibold">Follow-ups</h2>
              <FollowUpList personIds={[person.id]} dateFormat={settings.date_format} empty="No follow-ups for this person." />
            </section>
            {can(access, "care.view", "care.manage", "care.confidential") ? (
              <p className="text-sm">
                <Link href={`/care/pastoral?person=${person.id}`} className="text-link hover:underline">
                  Open pastoral care history
                </Link>{" "}
                <span className="text-muted-foreground">(you will only see the records shared with you).</span>
              </p>
            ) : null}
          </TabsContent>
        ) : null}

        {canSeeLogs ? (
          <TabsContent value="activity">
            {logs.length === 0 ? (
              <EmptyState title="No activity recorded for this record yet." />
            ) : (
              <ul className="scroll-list divide-y rounded-xl border bg-card">
                {logs.map((log) => (
                  <li key={log.id} className="flex flex-col gap-0.5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span>{log.description}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(log.created_at, settings.timezone)}</span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
