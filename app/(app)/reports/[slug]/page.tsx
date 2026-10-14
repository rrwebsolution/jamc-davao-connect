import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportActions } from "@/components/reports/report-actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BackLink } from "@/components/shared/blocks";
import { FilterBar } from "@/components/shared/filter-bar";
import { DateFilter, FilterSelect } from "@/components/shared/list-controls";
import { EmptyState, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getBranding } from "@/lib/branding";
import { getChurchToday, parseListParams } from "@/lib/data/common";
import { findReport, REPORT_ROW_LIMIT } from "@/lib/data/reports";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Report" };

async function ReportContent({ params, searchParams }: PageProps<"/reports/[slug]">) {
  const access = await requireAccess();
  const { slug } = await params;
  const report = findReport(slug);
  if (!report) notFound();
  // Needs the Reports permission AND the module's own permission. The data
  // itself is then read under the user's RLS, export included.
  if (!can(access, P.reportsView) || !can(access, ...report.permissions)) {
    return <NoAccess />;
  }

  const { params: filters } = parseListParams(await searchParams);
  const [result, branding, today] = await Promise.all([
    report.load(await createClient(), filters),
    getBranding(),
    getChurchToday(),
  ]);
  const hasFilters = Object.keys(filters).length > 0;

  return (
    <>
      <div className="print:hidden">
        <BackLink href="/reports">Back to reports</BackLink>
      </div>
      <PageHeader
        title={report.title}
        description={report.description}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <ReportActions title={report.title} columns={result.columns} rows={result.rows} canExport={can(access, P.reportsExport)} />
          </div>
        }
      />

      {/* Printed header: who, what, when. */}
      <p className="mb-3 hidden text-sm print:block">
        {branding.church_name} · generated {formatDate(today)} by {access.fullName}
      </p>

      {result.dates || result.filters.length > 0 ? (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center print:hidden">
          <FilterBar params={filters}>
            {result.dates ? (
              <>
                <DateFilter params={filters} paramKey="from" label="From" />
                <DateFilter params={filters} paramKey="to" label="To" />
              </>
            ) : null}
            {result.filters.map((filter) => (
              <FilterSelect key={filter.key} params={filters} paramKey={filter.key} label={filter.label} options={filter.options} />
            ))}
            {hasFilters ? (
              <Link href={`/reports/${report.slug}`} className="text-sm text-link hover:underline">
                Clear filters
              </Link>
            ) : null}
          </FilterBar>
        </div>
      ) : null}
      {result.dates ? <p className="mb-2 text-xs text-muted-foreground print:hidden">Dates filter by {result.dates}.</p> : null}

      {result.summary ? <p className="mb-3 text-sm font-medium">{result.summary}</p> : null}

      {result.rows.length === 0 ? (
        <EmptyState title="No data for this report." description={hasFilters ? "Try different filters." : "There is nothing to report yet."} />
      ) : (
        <>
          <ul data-reveal-list="" className="space-y-2 md:hidden print:hidden">
            {result.rows.map((row, index) => (
              <li key={index} className="rounded-xl border bg-card p-3">
                <p className="text-sm font-medium">{row[result.columns[0].key] || "—"}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  {result.columns.slice(1).map((column) => (
                    <div key={column.key} className="min-w-0">
                      <dt className="truncate text-muted-foreground">{column.label}</dt>
                      <dd className="truncate tabular-nums">
                        {typeof row[column.key] === "number" ? Number(row[column.key]).toLocaleString("en-PH") : row[column.key] || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block print:block print:overflow-visible print:rounded-none print:border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {result.columns.map((column) => (
                    <TableHead key={column.key} className={column.numeric ? "text-right" : undefined}>
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row, index) => (
                  <TableRow key={index}>
                    {result.columns.map((column) => (
                      <TableCell key={column.key} className={column.numeric ? "text-right tabular-nums" : "whitespace-normal"}>
                        {typeof row[column.key] === "number" ? Number(row[column.key]).toLocaleString("en-PH") : row[column.key] || "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {result.rows.length} {result.rows.length === 1 ? "row" : "rows"}
            {result.rows.length >= REPORT_ROW_LIMIT ? `. Showing the first ${REPORT_ROW_LIMIT}; narrow the filters to see the rest.` : "."}
          </p>
        </>
      )}
    </>
  );
}

export default function ReportPage(props: PageProps<"/reports/[slug]">) {
  return (
    <PageBoundary fallback={<PageSkeleton variant="report" />}>
      <ReportContent {...props} />
    </PageBoundary>
  );
}