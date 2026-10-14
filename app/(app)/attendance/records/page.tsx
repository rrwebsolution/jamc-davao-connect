import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterBar } from "@/components/shared/filter-bar";
import { DateFilter, FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { StatusPill } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { listRecords } from "@/lib/data/attendance";
import { getChurchSettings, getLookup, getListParams } from "@/lib/data/common";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Attendance Records" };

async function RecordsContent({ searchParams }: Pick<PageProps<"/attendance/records">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.attendanceView, P.attendanceViewAssigned)) {
    return <NoAccess />;
  }

  const { params, page, from, pageSize } = await getListParams(await searchParams);
  const [list, types, statuses, settings] = await Promise.all([
    listRecords(params, from),
    getLookup("attendance_types"),
    getLookup("attendance_statuses"),
    getChurchSettings(),
  ]);
  const hasFilters = Object.keys(params).some((key) => key !== "page");

  return (
    <>
      <PageHeader title="Attendance Records" description="Every recorded mark, newest first." />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput params={params} placeholder="Search by person…" />
        <FilterBar params={params}>
          <FilterSelect params={params} paramKey="type" label="Type" options={types.map((t) => ({ value: t.id, label: t.name }))} />
          <FilterSelect params={params} paramKey="status" label="Status" options={statuses.map((s) => ({ value: s.id, label: s.name }))} />
          <DateFilter params={params} paramKey="from" label="From" />
          <DateFilter params={params} paramKey="to" label="To" />
        </FilterBar>
      </div>

      {list.failed ? (
        <LoadError what="the attendance records" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={hasFilters ? "No attendance records for these filters." : "No attendance has been recorded yet."}
          action={
            hasFilters ? (
              <Link href="/attendance/records" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : (
              <Link href="/attendance/services" className={buttonVariants()}>
                Go to services
              </Link>
            )
          }
        />
      ) : (
        <>
          <ul data-reveal-list="" className="space-y-2 md:hidden">
            {list.rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
                <div className="min-w-0">
                  <Link href={`/attendance/history?person=${row.person_id}`} className="block truncate text-sm font-medium hover:underline">
                    {row.person_name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDate(row.session_date, settings.date_format)} · {row.session_title}
                  </p>
                </div>
                <StatusPill tone={row.counts_as_present ? "success" : "danger"}>{row.status_name}</StatusPill>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(row.session_date, settings.date_format)}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/attendance/history?person=${row.person_id}`} className="hover:underline">
                        {row.person_name}
                      </Link>
                      {row.person_type === "visitor" ? <span className="ml-2 text-xs text-muted-foreground">Visitor</span> : null}
                    </TableCell>
                    <TableCell>
                      <Link href={`/attendance/services/${row.session_id}`} className="hover:underline">
                        {row.session_title}
                      </Link>
                    </TableCell>
                    <TableCell>{row.attendance_type_name}</TableCell>
                    <TableCell>
                      <StatusPill tone={row.counts_as_present ? "success" : "danger"}>{row.status_name}</StatusPill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination params={params} page={page} pageSize={pageSize} total={list.total} />
        </>
      )}
    </>
  );
}

export default function RecordsPage({ searchParams }: PageProps<"/attendance/records">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Attendance Records" description="Every recorded mark, newest first." />}>
      <RecordsContent searchParams={searchParams} />
    </PageBoundary>
  );
}
