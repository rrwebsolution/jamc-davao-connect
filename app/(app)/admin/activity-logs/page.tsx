import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterBar } from "@/components/shared/filter-bar";
import { DateFilter, FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, PAGE_SIZE, parseListParams } from "@/lib/data/common";
import { formatDateTime, titleCase } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Activity Logs" };

const MODULES = ["people", "attendance", "groups", "ministries", "discipleship", "users", "roles", "settings", "appearance"];

type LogRow = {
  id: string;
  action: string;
  module: string;
  description: string;
  created_at: string;
  user: { full_name: string; email: string } | null;
};

async function LogsContent({ searchParams }: Pick<PageProps<"/admin/activity-logs">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.logsView)) {
    return <NoAccess />;
  }

  const { params, page, from } = parseListParams(await searchParams);
  const settings = await getChurchSettings();
  const supabase = await createClient();

  let query = supabase
    .from("activity_logs")
    .select("id, action, module, description, created_at, user:profiles(full_name, email)", { count: "exact" });
  if (params.module && MODULES.includes(params.module)) query = query.eq("module", params.module);
  const term = (params.q ?? "").replace(/[%*]/g, " ").trim();
  if (term) query = query.ilike("description", `%${term}%`);
  // Day boundaries in the church's own timezone would need the offset; the
  // filter uses UTC days, which is close enough for browsing an audit trail.
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.from ?? "")) query = query.gte("created_at", `${params.from}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.to ?? "")) query = query.lte("created_at", `${params.to}T23:59:59Z`);

  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (error) {
    console.error("Failed to load activity logs", describeError(error));
    return <LoadError what="the activity logs" />;
  }
  const rows = (data ?? []) as unknown as LogRow[];
  const hasFilters = Object.keys(params).some((key) => key !== "page");
  const who = (row: LogRow) => row.user?.full_name || row.user?.email || "System";

  return (
    <>
      <PageHeader title="Activity Logs" description="Who changed what, and when. Entries are written by the database and cannot be edited." />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput params={params} placeholder="Search descriptions…" />
        <FilterBar params={params}>
          <FilterSelect params={params} paramKey="module" label="Module" options={MODULES.map((m) => ({ value: m, label: titleCase(m) }))} />
          <DateFilter params={params} paramKey="from" label="From" />
          <DateFilter params={params} paramKey="to" label="To" />
        </FilterBar>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={hasFilters ? "No activity matches these filters." : "No activity recorded yet."}
          action={
            hasFilters ? (
              <Link href="/admin/activity-logs" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="rounded-xl border bg-card p-3 text-sm">
                <p>{row.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {who(row)} · {titleCase(row.module)} · {formatDateTime(row.created_at, settings.timezone)}
                </p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date &amp; time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(row.created_at, settings.timezone)}</TableCell>
                    <TableCell>{who(row)}</TableCell>
                    <TableCell>{titleCase(row.module)}</TableCell>
                    <TableCell>{titleCase(row.action)}</TableCell>
                    <TableCell className="whitespace-normal">{row.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination params={params} page={page} pageSize={PAGE_SIZE} total={count ?? 0} />
        </>
      )}
    </>
  );
}

export default function ActivityLogsPage({ searchParams }: PageProps<"/admin/activity-logs">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Activity Logs" description="Who changed what, and when. Entries are written by the database and cannot be edited." />}>
      <LogsContent searchParams={searchParams} />
    </PageBoundary>
  );
}