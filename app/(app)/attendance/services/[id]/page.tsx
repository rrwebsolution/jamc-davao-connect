import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArrowLeft, Pencil } from "lucide-react";
import { archiveSession } from "@/app/(app)/attendance/actions";
import { AttendanceRecorder } from "@/components/attendance/attendance-recorder";
import { SessionDialog } from "@/components/attendance/session-dialog";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getSession, getSessionRoster } from "@/lib/data/attendance";
import { getChurchSettings, getChurchToday, getLookup } from "@/lib/data/common";
import { getCellGroupOptions } from "@/lib/data/people";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Record attendance" };

async function SessionContent({ params }: Pick<PageProps<"/attendance/services/[id]">, "params">) {
  const access = await requireAccess();
  if (!can(access, P.attendanceView, P.attendanceViewAssigned, "events.manage")) {
    return <NoAccess />;
  }

  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    notFound();
  }

  const [roster, statuses, types, groups, settings, today] = await Promise.all([
    getSessionRoster(session),
    getLookup("attendance_statuses"),
    getLookup("attendance_types"),
    getCellGroupOptions(),
    getChurchSettings(),
    getChurchToday(),
  ]);

  // The database decides per row; this only decides whether to show the controls.
  const canRecordAny = can(access, P.attendanceCreate, P.attendanceUpdate) || (Boolean(session.event_id) && can(access, "events.manage"));
  const canRecord = !session.archived_at && (canRecordAny || (can(access, P.attendanceManageAssigned) && Boolean(session.cell_group_id)));
  const canEdit = !session.archived_at && (can(access, P.attendanceUpdate) || (can(access, P.attendanceManageAssigned) && Boolean(session.cell_group_id)));

  return (
    <>
      <Link
        href={session.event_id ? `/events/${session.event_id}` : session.cell_group_id ? `/groups/${session.cell_group_id}` : "/attendance/services"}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to {session.event_id ? "the event" : session.cell_group_id ? "the cell group" : "services"}
      </Link>
      <PageHeader
        title={session.title}
        description={[
          formatDate(session.session_date, settings.date_format),
          session.attendance_type?.name,
          session.cell_group?.name,
          session.archived_at ? "Archived" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          canEdit ? (
            <>
              <SessionDialog
                session={session}
                types={types}
                groups={groups}
                groupRequired={!can(access, P.attendanceUpdate)}
                today={today}
                variant="outline"
                trigger={
                  <>
                    <Pencil /> Edit
                  </>
                }
              />
              <ConfirmButton
                action={archiveSession.bind(null, session.id)}
                title="Archive this session?"
                description="The session and its attendance will no longer count in reports and statistics."
                confirmLabel="Archive"
                successMessage="Session archived"
                redirectTo="/attendance/services"
                destructive
                variant="outline"
              >
                <Archive /> Archive
              </ConfirmButton>
            </>
          ) : null
        }
      />
      {session.notes ? <p className="mb-4 text-sm text-muted-foreground">{session.notes}</p> : null}
      <AttendanceRecorder
        key={session.id}
        sessionId={session.id}
        people={roster.people}
        statuses={statuses}
        initialMarks={roster.marks}
        canRecord={canRecord}
      />
    </>
  );
}

export default function SessionPage({ params }: PageProps<"/attendance/services/[id]">) {
  return (
    <PageBoundary fallback={<PageSkeleton />}>
      <SessionContent params={params} />
    </PageBoundary>
  );
}
