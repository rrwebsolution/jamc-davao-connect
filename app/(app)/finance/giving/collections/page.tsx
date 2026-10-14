import type { Metadata } from "next";
import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { PageBoundary } from "@/components/app/page-boundary";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money } from "@/components/shared/blocks";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { StatusPill } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import type { CollectionSummary } from "@/lib/data/collections";
import { cleanSearchTerm, getChurchSettings, getListParams } from "@/lib/data/common";
import { describeError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Giving collections" };

const DESCRIPTION = "Giving entered together for a service or event. Only posted collections count in reports and balances.";
const TONE = { draft: "warning", posted: "success", voided: "danger" } as const;
const LABEL = { draft: "Draft", posted: "Posted", voided: "Voided" } as const;

async function Content({ searchParams }: Pick<PageProps<"/finance/giving/collections">, "searchParams">) {
  const access = await requireAccess();
  // RLS returns nothing without finance.view; this just avoids an empty shell.
  if (!can(access, "finance.view")) {
    return <NoAccess />;
  }
  const canManage = can(access, "finance.manage");
  const { params, page, from, pageSize } = await getListParams(await searchParams);

  const supabase = await createClient();
  let query = supabase.from("giving_collection_summary").select("*", { count: "exact" });
  if (params.status === "draft" || params.status === "posted" || params.status === "voided") query = query.eq("status", params.status);
  const term = cleanSearchTerm(params.q);
  if (term) query = query.ilike("collection_name", `%${term}%`);

  const [list, settings] = await Promise.all([
    query.order("collection_date", { ascending: false }).order("created_at", { ascending: false }).range(from, from + pageSize - 1),
    getChurchSettings(),
  ]);
  if (list.error) {
    console.error("Failed to load collections", describeError(list.error));
    return <LoadError what="the collections" />;
  }
  const rows = (list.data ?? []) as CollectionSummary[];
  const hasFilters = Boolean(params.q || params.status);
  const newButton = canManage ? (
    <Link href="/finance/giving/collections/new" className={buttonVariants()}>
      <Plus /> New collection
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title="Giving collections"
        description={DESCRIPTION}
        actions={
          <>
            <Link href="/finance/giving" className={buttonVariants({ variant: "outline" })}>
              All giving
            </Link>
            {newButton}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput params={params} placeholder="Search collection name…" />
        <div className="sm:w-48">
          <FilterSelect
            params={params}
            paramKey="status"
            label="Status"
            options={[
              { value: "draft", label: "Draft" },
              { value: "posted", label: "Posted" },
              { value: "voided", label: "Voided" },
            ]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={hasFilters ? "Nothing matches these filters." : "No collections yet."}
          description={hasFilters ? undefined : "Record a whole service's giving in one go, instead of one entry at a time."}
          action={
            hasFilters ? (
              <Link href="/finance/giving/collections" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : (
              newButton
            )
          }
        />
      ) : (
        <>
          <ul data-reveal-list="" className="space-y-2 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/finance/giving/collections/${row.id}`} className="motion-card block rounded-xl border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate font-medium">{row.collection_name}</p>
                    <StatusPill tone={TONE[row.status]}>{LABEL[row.status]}</StatusPill>
                  </div>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{money(row.total)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[formatDate(row.collection_date, settings.date_format), `${row.entry_count} ${row.entry_count === 1 ? "entry" : "entries"}`, row.entry_mode === "summary" ? "Summary" : "Detailed"].join(" · ")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Collection</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Service / event</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recorded by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <Link href={`/finance/giving/collections/${row.id}`} className="text-link hover:underline">
                        {row.collection_name}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(row.collection_date, settings.date_format)}</TableCell>
                    <TableCell>{row.event_name ?? row.attendance_type_name ?? "—"}</TableCell>
                    <TableCell>{row.entry_mode === "summary" ? "Summary" : "Detailed"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.entry_count}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(row.total)}</TableCell>
                    <TableCell>
                      <StatusPill tone={TONE[row.status]}>{LABEL[row.status]}</StatusPill>
                    </TableCell>
                    <TableCell>{row.created_by_name ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination params={params} page={page} pageSize={pageSize} total={list.count ?? 0} />
        </>
      )}
    </>
  );
}

export default function Page({ searchParams }: PageProps<"/finance/giving/collections">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Giving collections" description={DESCRIPTION} />}>
      <Content searchParams={searchParams} />
    </PageBoundary>
  );
}
