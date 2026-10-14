import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { CalendarCheck, Plus } from "lucide-react";
import { SessionDialog } from "@/components/attendance/session-dialog";
import { buttonVariants } from "@/components/ui/button";
import { FilterBar } from "@/components/shared/filter-bar";
import { DateFilter, FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { listSessions } from "@/lib/data/attendance";
import { getChurchSettings, getChurchToday, getLookup, getListParams } from "@/lib/data/common";
import { getCellGroupOptions } from "@/lib/data/people";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Services" };

async function ServicesContent({ searchParams }: Pick<PageProps<"/attendance/services">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.attendanceView, P.attendanceViewAssigned)) {
    return <NoAccess />;
  }

  const { params, page, from, pageSize } = await getListParams(await searchParams);
  const [list, types, groups, settings, today] = await Promise.all([
    listSessions(params, from),
    getLookup("attendance_types"),
    getCellGroupOptions(),
    getChurchSettings(),
    getChurchToday(),
  ]);

  const canCreateAny = can(access, P.attendanceCreate);
  const canCreate = canCreateAny || (can(access, P.attendanceManageAssigned) && groups.length > 0);
  const hasFilters = Object.keys(params).some((key) => key !== "page" && key !== "new");

  const createButton = canCreate ? (
    <SessionDialog
      types={types}
      groups={groups}
      groupRequired={!canCreateAny}
      today={today}
      defaultOpen={params.new === "1"}
      trigger={
        <>
          <Plus /> New session
        </>
      }
    />
  ) : null;

  return (
    <>
      <PageHeader
        title="Services"
        description="Each service, meeting or event that attendance is recorded for."
        actions={createButton}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput params={params} placeholder="Search sessions…" />
        <FilterBar params={params}>
          <FilterSelect params={params} paramKey="type" label="Type" options={types.map((t) => ({ value: t.id, label: t.name }))} />
          <DateFilter params={params} paramKey="from" label="From" />
          <DateFilter params={params} paramKey="to" label="To" />
        </FilterBar>
      </div>

      {list.failed ? (
        <LoadError what="the sessions" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={hasFilters ? "No sessions match these filters." : "No attendance sessions yet."}
          description={hasFilters ? undefined : "Create a session for a service or event, then record who attended."}
          action={
            hasFilters ? (
              <Link href="/attendance/services" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : (
              createButton
            )
          }
        />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.rows.map((session) => {
              const totals = list.totals[session.id];
              return (
                <li key={session.id}>
                  <Link
                    href={`/attendance/services/${session.id}`}
                    className="block h-full rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-ring"
                  >
                    <p className="text-xs text-muted-foreground">
                      {formatDate(session.session_date, settings.date_format)} · {session.attendance_type?.name}
                    </p>
                    <p className="mt-1 truncate font-medium">{session.title}</p>
                    {session.cell_group ? (
                      <p className="truncate text-xs text-muted-foreground">{session.cell_group.name}</p>
                    ) : null}
                    <p className="mt-3 text-sm">
                      {totals ? (
                        <>
                          <span className="font-semibold tabular-nums">{totals.present}</span> present
                          <span className="text-muted-foreground"> · {totals.absent} absent</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Not recorded yet</span>
                      )}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Pagination params={params} page={page} pageSize={pageSize} total={list.total} />
        </>
      )}
    </>
  );
}

export default function ServicesPage({ searchParams }: PageProps<"/attendance/services">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Services" description="Each service, meeting or event that attendance is recorded for." variant="cards" />}>
      <ServicesContent searchParams={searchParams} />
    </PageBoundary>
  );
}
