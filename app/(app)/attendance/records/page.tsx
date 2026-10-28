import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { CalendarCheck, ClipboardList, Percent, UserPlus, Users } from "lucide-react";
import {
  AttendanceStatus,
  AttendanceTrend,
  ChartCard,
  ChartFilterChips,
  GroupRates,
  MembersVisitors,
  MonthlyAttendance,
} from "@/components/attendance/records-charts";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/shared/blocks";
import { FilterBar } from "@/components/shared/filter-bar";
import { DateFilter, FilterSelect, Pagination, SearchInput, SortLink } from "@/components/shared/list-controls";
import { StatusPill } from "@/components/shared/person-avatar";
import { RowMenu } from "@/components/shared/row-menu";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import {
  DEFAULT_RECORD_RANGE,
  getRecordsSummary,
  getSession,
  listRecords,
  listSessionOptions,
  RECORD_RANGES,
  resolveRecordFilters,
  type AttendanceRecordRow,
  type RecordsSummary,
} from "@/lib/data/attendance";
import { getChurchSettings, getChurchToday, getListParams, getLookup } from "@/lib/data/common";
import { getCellGroupOptions } from "@/lib/data/people";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Attendance Records" };

const DESCRIPTION = "View attendance history, trends, and service participation.";
const counts = new Intl.NumberFormat("en-PH");

/** Late and excused read differently from present and absent; the text always says which. */
function statusTone(row: Pick<AttendanceRecordRow, "status_name" | "counts_as_present">) {
  if (/late/i.test(row.status_name)) return "warning" as const;
  if (/excus/i.test(row.status_name)) return "info" as const;
  return row.counts_as_present ? ("success" as const) : ("danger" as const);
}

async function RecordsContent({ searchParams }: Pick<PageProps<"/attendance/records">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.attendanceView, P.attendanceViewAssigned)) {
    return <NoAccess />;
  }

  const [{ params, page, from, pageSize }, today] = await Promise.all([getListParams(await searchParams), getChurchToday()]);
  // One set of filters for the figures, the charts and the list, so they always agree.
  const filters = resolveRecordFilters(params, today);
  const [summary, list, types, statuses, groups, sessions, settings, chosenSession] = await Promise.all([
    getRecordsSummary(filters),
    listRecords(filters, from, { column: params.sort, dir: params.dir }),
    getLookup("attendance_types"),
    getLookup("attendance_statuses"),
    getCellGroupOptions(),
    listSessionOptions(filters),
    getChurchSettings(),
    filters.session ? getSession(filters.session) : null,
  ]);
  const date = (value: string) => formatDate(value, settings.date_format);
  const canMark = can(access, P.attendanceCreate, P.attendanceManageAssigned);
  const hasFilters = Object.keys(params).some((key) => !["page", "sort", "dir"].includes(key));

  // Filters a chart can set, shown as chips above the charts.
  const chips = [
    filters.status && { key: "status", label: statuses.find((s) => s.id === filters.status)?.name ?? "Status" },
    filters.who && { key: "who", label: filters.who === "member" ? "Members" : "Visitors" },
    filters.group && { key: "group", label: groups.find((g) => g.id === filters.group)?.name ?? "Cell group" },
    filters.session && {
      key: "session",
      label: chosenSession ? `${chosenSession.title} · ${date(chosenSession.session_date)}` : "One session",
    },
  ].filter((chip): chip is { key: string; label: string } => Boolean(chip));

  const custom = filters.range === "custom";
  const filterControls = (
    <div className="mb-4 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <SearchInput params={params} placeholder="Search by person…" />
      <FilterBar params={params} inline={custom ? 5 : 3}>
        <FilterSelect
          params={params}
          paramKey="range"
          label="Period"
          allLabel={RECORD_RANGES.find((range) => range.value === DEFAULT_RECORD_RANGE)!.label}
          options={RECORD_RANGES.filter((range) => range.value !== DEFAULT_RECORD_RANGE).map((range) => ({ value: range.value, label: range.label }))}
        />
        {custom ? <DateFilter params={params} paramKey="from" label="From" /> : null}
        {custom ? <DateFilter params={params} paramKey="to" label="To" /> : null}
        <FilterSelect params={params} paramKey="type" label="Type" options={types.map((t) => ({ value: t.id, label: t.name }))} />
        <FilterSelect params={params} paramKey="status" label="Status" options={statuses.map((s) => ({ value: s.id, label: s.name }))} />
        <FilterSelect
          params={params}
          paramKey="session"
          label="Service"
          options={sessions.map((s) => ({ value: s.id, label: `${s.title} · ${date(s.session_date)}` }))}
        />
        <FilterSelect params={params} paramKey="group" label="Cell group" options={groups.map((g) => ({ value: g.id, label: g.name }))} />
        <FilterSelect
          params={params}
          paramKey="who"
          label="People"
          options={[
            { value: "member", label: "Members" },
            { value: "visitor", label: "Visitors" },
          ]}
        />
      </FilterBar>
    </div>
  );

  const header = (
    <PageHeader
      title="Attendance Records"
      description={DESCRIPTION}
      actions={
        canMark ? (
          <Link href="/attendance/services" className={buttonVariants()}>
            <CalendarCheck /> Mark attendance
          </Link>
        ) : null
      }
    />
  );

  if (!summary || list.failed) {
    return (
      <>
        {header}
        {filterControls}
        <LoadError what="the attendance records" />
      </>
    );
  }

  // Registered visitors are shown even when nobody was marked in attendance.
  if (summary.marks === 0 && summary.new_visitors === 0) {
    return (
      <>
        {header}
        {filterControls}
        <ChartFilterChips params={params} chips={chips} />
        <EmptyState
          icon={ClipboardList}
          title="No attendance data available"
          description="There are no attendance records for the selected filters."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {hasFilters ? (
                <Link href="/attendance/records" className={buttonVariants({ variant: "outline" })}>
                  Clear filters
                </Link>
              ) : null}
              {canMark ? (
                <Link href="/attendance/services" className={buttonVariants()}>
                  Mark attendance
                </Link>
              ) : null}
            </div>
          }
        />
      </>
    );
  }

  const average = summary.sessions > 0 ? Math.round(summary.present / summary.sessions) : 0;
  const rate = summary.marks > 0 ? Math.round((summary.present / summary.marks) * 100) : 0;

  return (
    <>
      {header}
      {filterControls}
      <ChartFilterChips params={params} chips={chips} />

      <div data-reveal-list="" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard icon={Users} label="Total attendance" value={counts.format(summary.present)} note={`${counts.format(summary.sessions)} ${summary.sessions === 1 ? "session" : "sessions"}`} />
        <StatCard icon={CalendarCheck} label="Average attendance" value={counts.format(average)} note="present per session" />
        {/* Visitors registered in the period, as on the dashboard; marks are a separate figure. */}
        <StatCard
          icon={UserPlus}
          label="Visitors"
          value={counts.format(summary.new_visitors)}
          note={`first-time · ${counts.format(summary.visitors_present)} marked present`}
        />
        <StatCard icon={Percent} label="Attendance rate" value={`${rate}%`} note={`${counts.format(summary.absent)} absent`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard title="Attendance Trend" description="Attendance over the selected period. Click a date to see its records." className="lg:col-span-2">
          <AttendanceTrend data={summary.trend} params={params} />
        </ChartCard>
        <ChartCard title="Attendance Status" description="Every mark in the period.">
          <AttendanceStatus statuses={summary.statuses} params={params} />
        </ChartCard>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        <div className="space-y-4">
          <ChartCard title="Members vs Visitors" description="Who was marked present.">
            <MembersVisitors members={summary.members_present} visitors={summary.visitors_present} params={params} />
          </ChartCard>
          <FirstVisitors summary={summary} date={date} canSeeVisitors={can(access, P.visitorsView)} />
        </div>
        <ChartCard title="Attendance by Cell Group" description="Present out of everyone marked in each group.">
          <GroupRates groups={summary.groups} params={params} />
        </ChartCard>
      </div>

      <div className="mt-4">
        <ChartCard title="Monthly Attendance" description="Members and visitors present each month.">
          {summary.monthly.length >= 2 ? (
            <MonthlyAttendance monthly={summary.monthly} />
          ) : (
            <p className="flex h-24 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">
              The monthly comparison appears when the period covers at least two months of attendance.
            </p>
          )}
        </ChartCard>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">Records</h2>
          <p className="text-xs text-muted-foreground">{counts.format(list.total)} marks</p>
        </div>

        {list.rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No records on this page." />
        ) : (
          <>
            <ul data-reveal-list="" className="space-y-2 md:hidden">
              {list.rows.map((row) => (
                <li key={row.id} className="rounded-xl border bg-card p-3.5 shadow-xs">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/attendance/history?person=${row.person_id}`} className="min-w-0 truncate font-medium hover:underline">
                          {row.person_name}
                        </Link>
                        <StatusPill tone={statusTone(row)}>{row.status_name}</StatusPill>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {date(row.session_date)} · {row.session_title}
                      </p>
                      <p className="mt-1 truncate text-sm">
                        {[row.person_type === "visitor" ? "Visitor" : null, row.person_cell_group_name].filter(Boolean).join(" · ") || (
                          <span className="text-muted-foreground">No cell group</span>
                        )}
                      </p>
                      {row.notes ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.notes}</p> : null}
                    </div>
                    <RecordMenu row={row} />
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-hidden rounded-xl border bg-card shadow-xs md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <SortLink params={params} column="session_date">Date</SortLink>
                    </TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>
                      <SortLink params={params} column="person_name">Person</SortLink>
                    </TableHead>
                    <TableHead>
                      <SortLink params={params} column="person_cell_group_name">Cell group</SortLink>
                    </TableHead>
                    <TableHead>
                      <SortLink params={params} column="status_name">Status</SortLink>
                    </TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-12 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-muted-foreground">{date(row.session_date)}</TableCell>
                      <TableCell>
                        <Link href={`/attendance/services/${row.session_id}`} className="block max-w-56 truncate hover:underline">
                          {row.session_title}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{row.attendance_type_name}</span>
                      </TableCell>
                      <TableCell>
                        <Link href={`/attendance/history?person=${row.person_id}`} className="block max-w-56 truncate font-medium hover:underline">
                          {row.person_name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{row.person_type === "visitor" ? "Visitor" : "Member"}</span>
                      </TableCell>
                      <TableCell>{row.person_cell_group_name ?? "—"}</TableCell>
                      <TableCell>
                        <StatusPill tone={statusTone(row)}>{row.status_name}</StatusPill>
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-56 truncate text-muted-foreground" title={row.notes ?? undefined}>
                          {row.notes || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <RecordMenu row={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination params={params} page={page} pageSize={pageSize} total={list.total} />
          </>
        )}
      </section>
    </>
  );
}

/**
 * First-time visitors registered in the period. They count as visitors here
 * and on the dashboard; a registration is not an attendance mark, so each
 * says whether they were also marked present that day.
 */
function FirstVisitors({
  summary,
  date,
  canSeeVisitors,
}: {
  summary: RecordsSummary;
  date: (value: string) => string;
  canSeeVisitors: boolean;
}) {
  const more = summary.new_visitors - summary.first_visitors.length;
  return (
    <ChartCard
      title="First-time Visitors"
      description="Registered as visitors in this period."
      action={
        canSeeVisitors ? (
          <Link href="/people/visitors" className="shrink-0 text-sm text-link hover:underline">
            View all
          </Link>
        ) : null
      }
    >
      {summary.first_visitors.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No first-time visitors in this period.</p>
      ) : (
        <ul className="-mx-1 divide-y">
          {summary.first_visitors.map((visitor) => (
            <li key={visitor.id} className="flex items-center justify-between gap-3 px-1 py-2.5">
              <div className="min-w-0">
                <Link
                  href={`/people/${visitor.person_type === "member" ? "members" : "visitors"}/${visitor.id}`}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {visitor.full_name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {[date(visitor.first_visit_date), visitor.service_name, visitor.person_type === "member" ? "Now a member" : null, visitor.archived ? "Archived" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {visitor.marked_present ? <StatusPill tone="success">Marked present</StatusPill> : <StatusPill>Not in attendance</StatusPill>}
            </li>
          ))}
        </ul>
      )}
      {more > 0 ? <p className="mt-2 text-xs text-muted-foreground">and {counts.format(more)} more</p> : null}
    </ChartCard>
  );
}

function RecordMenu({ row }: { row: AttendanceRecordRow }) {
  return (
    <RowMenu
      label={`Actions for ${row.person_name} on ${row.session_date}`}
      items={[
        { label: "Open session", icon: "view", href: `/attendance/services/${row.session_id}` },
        { label: "Attendance history", icon: "view", href: `/attendance/history?person=${row.person_id}` },
      ]}
    />
  );
}

export default function RecordsPage({ searchParams }: PageProps<"/attendance/records">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Attendance Records" description={DESCRIPTION} variant="analytics" />}>
      <RecordsContent searchParams={searchParams} />
    </PageBoundary>
  );
}
