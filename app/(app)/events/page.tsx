import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus } from "lucide-react";
import { saveEvent } from "@/app/(app)/module-actions";
import { buttonVariants } from "@/components/ui/button";
import { formatTime } from "@/components/shared/blocks";
import { EntityDialog } from "@/components/shared/entity-dialog";
import { FilterBar } from "@/components/shared/filter-bar";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { StatusPill } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { cleanSearchTerm, getChurchSettings, getChurchToday, PAGE_SIZE, parseListParams } from "@/lib/data/common";
import { EVENT_FIELDS, EVENT_TONE, eventValues, type EventRow } from "@/lib/data/events";
import { EVENT_STATUSES, EVENT_TYPES, labelOf } from "@/lib/data/options";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Events" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (value: number) => String(value).padStart(2, "0");

function shiftMonth(month: string, by: number) {
  const [year, index] = month.split("-").map(Number);
  const total = year * 12 + (index - 1) + by;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

function MonthGrid({ month, events, today }: { month: string; events: EventRow[]; today: string }) {
  const [year, index] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, index - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted text-center text-xs font-medium text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="py-2">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, cell) => {
          const date = day ? `${month}-${pad(day)}` : null;
          const onDay = date ? events.filter((event) => event.event_date === date) : [];
          return (
            <div key={cell} className="min-h-16 border-b border-r p-1 last:border-r-0 sm:min-h-24 [&:nth-child(7n)]:border-r-0">
              {day ? (
                <>
                  <span
                    className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${
                      date === today ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {day}
                  </span>
                  <ul className="mt-0.5 space-y-0.5">
                    {onDay.map((event) => (
                      <li key={event.id}>
                        <Link
                          href={`/events/${event.id}`}
                          title={event.name}
                          className={`block truncate rounded px-1 py-0.5 text-[11px] leading-tight hover:underline ${
                            event.status === "cancelled" ? "text-muted-foreground line-through" : "bg-accent text-foreground"
                          }`}
                        >
                          {event.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function EventsContent({ searchParams }: Pick<PageProps<"/events">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, "events.view", "events.manage")) {
    return <NoAccess />;
  }
  const { params, page, from } = parseListParams(await searchParams);
  const canManage = can(access, "events.manage");
  const [today, settings] = await Promise.all([getChurchToday(), getChurchSettings()]);

  const calendar = params.view === "calendar";
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "") ? params.month! : today.slice(0, 7);

  const supabase = await createClient();
  let query = supabase.from("event_directory").select("*", { count: "exact" }).is("archived_at", null);
  if (calendar) {
    query = query.gte("event_date", `${month}-01`).lt("event_date", `${shiftMonth(month, 1)}-01`);
  } else {
    if (params.when === "past") query = query.lt("event_date", today);
    else if (params.when !== "all") query = query.gte("event_date", today);
    if (params.status) query = query.eq("status", params.status);
    if (params.type) query = query.eq("event_type", params.type);
    const term = cleanSearchTerm(params.q);
    if (term) query = query.or(`name.ilike.%${term}%,venue.ilike.%${term}%`);
  }
  const ordered = query.order("event_date", { ascending: params.when !== "past" }).order("start_time", { nullsFirst: true });
  const { data, count, error } = calendar ? await ordered.limit(500) : await ordered.range(from, from + PAGE_SIZE - 1);
  if (error) {
    console.error("Failed to load events", describeError(error));
    return <LoadError what="the events" />;
  }
  const rows = (data ?? []) as EventRow[];
  const hasFilters = Object.keys(params).some((key) => !["page", "view", "month", "new"].includes(key));

  const createButton = canManage ? (
    <EntityDialog
      title="New event"
      fields={EVENT_FIELDS}
      initial={eventValues(null, today)}
      action={saveEvent.bind(null, null)}
      submitLabel="Create event"
      successMessage="Event created"
      redirectOnCreate="/events"
      defaultOpen={params.new === "1"}
    >
      <Plus /> New event
    </EntityDialog>
  ) : null;

  const [year, monthIndex] = month.split("-").map(Number);

  return (
    <>
      <PageHeader
        title="Events"
        description="Services, meetings and church activities."
        actions={
          <>
            <div className="flex rounded-lg border p-0.5">
              <Link href="/events" className={buttonVariants({ variant: calendar ? "ghost" : "secondary", size: "sm" })} aria-current={!calendar ? "page" : undefined}>
                <List /> List
              </Link>
              <Link
                href="/events?view=calendar"
                className={buttonVariants({ variant: calendar ? "secondary" : "ghost", size: "sm" })}
                aria-current={calendar ? "page" : undefined}
              >
                <CalendarDays /> Calendar
              </Link>
            </div>
            {createButton}
          </>
        }
      />

      {calendar ? (
        <>
          <div className="mb-3 flex items-center justify-between">
            <Link href={`/events?view=calendar&month=${shiftMonth(month, -1)}`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Previous month">
              <ChevronLeft />
            </Link>
            <p className="font-medium">
              {MONTHS[monthIndex - 1]} {year}
            </p>
            <Link href={`/events?view=calendar&month=${shiftMonth(month, 1)}`} className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Next month">
              <ChevronRight />
            </Link>
          </div>
          <MonthGrid month={month} events={rows} today={today} />
          {rows.length === 0 ? <p className="mt-3 text-center text-sm text-muted-foreground">No events this month.</p> : null}
        </>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <SearchInput params={params} placeholder="Search events or venues…" />
            <FilterBar params={params}>
              <FilterSelect
                params={params}
                paramKey="when"
                label="When"
                allLabel="Upcoming"
                options={[
                  { value: "past", label: "Past" },
                  { value: "all", label: "All dates" },
                ]}
              />
              <FilterSelect params={params} paramKey="status" label="Status" options={[...EVENT_STATUSES]} />
              <FilterSelect params={params} paramKey="type" label="Type" options={[...EVENT_TYPES]} />
            </FilterBar>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title={hasFilters ? "No events match these filters." : "No upcoming events."}
              action={
                hasFilters ? (
                  <Link href="/events" className={buttonVariants({ variant: "outline" })}>
                    Clear filters
                  </Link>
                ) : (
                  createButton
                )
              }
            />
          ) : (
            <>
              <ul className="space-y-2">
                {rows.map((event) => (
                  <li key={event.id}>
                    <Link href={`/events/${event.id}`} className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-ring sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{event.name}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {[
                            event.event_date === today ? "Today" : formatDate(event.event_date, settings.date_format),
                            [formatTime(event.start_time), formatTime(event.end_time)].filter(Boolean).join(" – "),
                            event.venue,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        <StatusPill>{labelOf(EVENT_TYPES, event.event_type)}</StatusPill>
                        <StatusPill tone={EVENT_TONE[event.status]}>{labelOf(EVENT_STATUSES, event.status)}</StatusPill>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination params={params} page={page} pageSize={PAGE_SIZE} total={count ?? 0} />
            </>
          )}
        </>
      )}
    </>
  );
}

export default function EventsPage({ searchParams }: PageProps<"/events">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Events" description="Services, meetings and church activities." />}>
      <EventsContent searchParams={searchParams} />
    </PageBoundary>
  );
}
