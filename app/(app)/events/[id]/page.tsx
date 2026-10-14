import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Pencil, RotateCcw } from "lucide-react";
import { saveEvent, setEventStatus } from "@/app/(app)/module-actions";
import { EventAttendanceButton } from "@/components/events/attendance-button";
import { BackLink, Detail, formatTime, ListEmpty, Panel } from "@/components/shared/blocks";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog } from "@/components/shared/entity-dialog";
import { StatusPill } from "@/components/shared/person-avatar";
import { NoAccess, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, getChurchToday, isUuid } from "@/lib/data/common";
import { EVENT_FIELDS, EVENT_TONE, eventValues, type EventRow } from "@/lib/data/events";
import { EVENT_STATUSES, EVENT_TYPES, labelOf } from "@/lib/data/options";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Event" };

async function EventContent({ params }: Pick<PageProps<"/events/[id]">, "params">) {
  const access = await requireAccess();
  if (!can(access, "events.view", "events.manage")) {
    return <NoAccess />;
  }
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [{ data }, settings, today] = await Promise.all([
    supabase.from("event_directory").select("*").eq("id", id).maybeSingle(),
    getChurchSettings(),
    getChurchToday(),
  ]);
  const event = data as EventRow | null;
  if (!event) notFound();

  const canManage = can(access, "events.manage");
  const canRecord = canManage || can(access, P.attendanceCreate);
  const canSeeAttendance = canRecord || can(access, P.attendanceView);

  const attendees = event.session_id && canSeeAttendance
    ? await supabase
        .from("attendance_record_details")
        .select("id, person_id, person_name, person_type, status_name, counts_as_present")
        .eq("session_id", event.session_id)
        .order("person_name")
        .limit(500)
    : null;
  const rows = attendees?.data ?? [];
  const members = rows.filter((row) => row.counts_as_present && row.person_type === "member").length;
  const visitors = rows.filter((row) => row.counts_as_present && row.person_type === "visitor").length;

  return (
    <>
      <BackLink href="/events">Back to events</BackLink>

      <div className="mb-4 flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold sm:text-2xl">{event.name}</h1>
            <StatusPill tone={EVENT_TONE[event.status]}>{labelOf(EVENT_STATUSES, event.status)}</StatusPill>
          </div>
          {event.description ? <p className="mt-2 max-w-2xl whitespace-pre-line text-sm text-muted-foreground">{event.description}</p> : null}
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Date">{formatDate(event.event_date, settings.date_format)}</Detail>
            <Detail label="Time">{[formatTime(event.start_time), formatTime(event.end_time)].filter(Boolean).join(" – ")}</Detail>
            <Detail label="Venue">{event.venue}</Detail>
            <Detail label="Type">{labelOf(EVENT_TYPES, event.event_type)}</Detail>
            <Detail label="Organizer">{event.organizer}</Detail>
          </dl>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <EntityDialog
              title="Edit event"
              fields={EVENT_FIELDS}
              initial={eventValues(event, today)}
              action={saveEvent.bind(null, event.id)}
              successMessage="Event updated"
              variant="outline"
            >
              <Pencil /> Edit
            </EntityDialog>
            {event.status === "cancelled" ? (
              <ConfirmButton
                action={setEventStatus.bind(null, event.id, "upcoming")}
                title="Reinstate this event?"
                description="Its status goes back to Upcoming."
                confirmLabel="Reinstate"
                successMessage="Event reinstated"
                variant="outline"
              >
                <RotateCcw /> Reinstate
              </ConfirmButton>
            ) : (
              <ConfirmButton
                action={setEventStatus.bind(null, event.id, "cancelled")}
                title="Cancel this event?"
                description="The event stays on record, marked as cancelled, and stops appearing as upcoming."
                confirmLabel="Cancel event"
                successMessage="Event cancelled"
                destructive
                variant="outline"
              >
                <Ban /> Cancel event
              </ConfirmButton>
            )}
          </div>
        ) : null}
      </div>

      {canSeeAttendance ? (
        <Panel
          title="Event attendance"
          description={
            event.session_id
              ? `${members + visitors} present: ${members} ${members === 1 ? "member" : "members"}, ${visitors} ${visitors === 1 ? "visitor" : "visitors"}.`
              : "Members and visitors can both be marked."
          }
          flush
          actions={canRecord && event.status !== "cancelled" ? <EventAttendanceButton eventId={event.id} hasSession={Boolean(event.session_id)} /> : null}
        >
          {rows.length === 0 ? (
            <ListEmpty>No attendance recorded for this event yet.</ListEmpty>
          ) : (
            <ul className="scroll-list divide-y">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <Link href={`/people/${row.person_type === "visitor" ? "visitors" : "members"}/${row.person_id}`} className="truncate font-medium hover:underline">
                    {row.person_name}
                    {row.person_type === "visitor" ? <span className="ml-2 text-xs font-normal text-muted-foreground">Visitor</span> : null}
                  </Link>
                  <StatusPill tone={row.counts_as_present ? "success" : "danger"}>{row.status_name}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </>
  );
}

export default function EventPage({ params }: PageProps<"/events/[id]">) {
  return (
    <PageBoundary fallback={<PageSkeleton variant="detail" />}>
      <EventContent params={params} />
    </PageBoundary>
  );
}
