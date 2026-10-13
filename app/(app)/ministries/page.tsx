import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { Network, Plus } from "lucide-react";
import { saveMinistry } from "@/app/(app)/module-actions";
import { buttonVariants } from "@/components/ui/button";
import { EntityDialog, type FieldDef } from "@/components/shared/entity-dialog";
import { FilterBar } from "@/components/shared/filter-bar";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { StatusPill } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { cleanSearchTerm, PAGE_SIZE, parseListParams } from "@/lib/data/common";
import { getPeopleOptions, type SelectOption } from "@/lib/data/options";
import { createClient } from "@/lib/supabase/server";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Ministries" };

export type MinistryRow = {
  id: string;
  name: string;
  description: string | null;
  leader_id: string | null;
  assistant_leader_id: string | null;
  leader_name: string | null;
  assistant_leader_name: string | null;
  is_active: boolean;
  archived_at: string | null;
  member_count: number;
};

function ministryFields(members: SelectOption[]): FieldDef[] {
  return [
    { name: "name", label: "Ministry name", type: "text", required: true, wide: true },
    { name: "leader_id", label: "Leader", type: "select", options: members, emptyLabel: "No leader yet" },
    { name: "assistant_leader_id", label: "Assistant leader", type: "select", options: members, emptyLabel: "None" },
    { name: "description", label: "Description", type: "textarea" },
    { name: "is_active", label: "Active", type: "switch" },
  ];
}

async function MinistriesContent({ searchParams }: Pick<PageProps<"/ministries">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.ministriesView, P.ministriesManage)) {
    return <NoAccess />;
  }
  const { params, page, from } = parseListParams(await searchParams);
  const canManage = can(access, P.ministriesManage);

  const supabase = await createClient();
  let query = supabase.from("ministry_directory").select("*", { count: "exact" });
  if (params.status === "archived") query = query.not("archived_at", "is", null);
  else {
    query = query.is("archived_at", null);
    if (params.status === "active") query = query.eq("is_active", true);
    if (params.status === "inactive") query = query.eq("is_active", false);
  }
  const term = cleanSearchTerm(params.q);
  if (term) query = query.ilike("name", `%${term}%`);

  const [{ data, count, error }, members] = await Promise.all([
    query.order("sort_order").order("name").range(from, from + PAGE_SIZE - 1),
    canManage ? getPeopleOptions("member") : [],
  ]);
  if (error) {
    console.error("Failed to load ministries", describeError(error));
    return <LoadError what="the ministries" />;
  }
  const rows = (data ?? []) as MinistryRow[];
  const hasFilters = Object.keys(params).some((key) => key !== "page");

  const createButton = canManage ? (
    <EntityDialog
      title="New ministry"
      fields={ministryFields(members)}
      initial={{ name: "", description: "", leader_id: "", assistant_leader_id: "", is_active: true }}
      action={saveMinistry.bind(null, null)}
      submitLabel="Create ministry"
      successMessage="Ministry created"
      redirectOnCreate="/ministries"
    >
      <Plus /> New ministry
    </EntityDialog>
  ) : null;

  return (
    <>
      <PageHeader title="Ministries" description="The teams members serve in." actions={createButton} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput params={params} placeholder="Search ministries…" />
        <FilterBar params={params}>
          <FilterSelect
            params={params}
            paramKey="status"
            label="Status"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "archived", label: "Archived" },
            ]}
          />
        </FilterBar>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Network}
          title={hasFilters ? "No ministries match these filters." : "No ministries yet."}
          action={
            hasFilters ? (
              <Link href="/ministries" className={buttonVariants({ variant: "outline" })}>
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
            {rows.map((ministry) => (
              <li key={ministry.id}>
                <Link href={`/ministries/${ministry.id}`} className="block h-full rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-ring">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium">{ministry.name}</p>
                    {ministry.archived_at ? (
                      <StatusPill tone="danger">Archived</StatusPill>
                    ) : ministry.is_active ? (
                      <StatusPill tone="success">Active</StatusPill>
                    ) : (
                      <StatusPill>Inactive</StatusPill>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {ministry.leader_name ? `Led by ${ministry.leader_name}` : "No leader assigned"}
                  </p>
                  <p className="mt-3 text-sm">
                    <span className="font-semibold tabular-nums">{ministry.member_count}</span>{" "}
                    {ministry.member_count === 1 ? "member" : "members"} serving
                  </p>
                  {ministry.description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ministry.description}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
          <Pagination params={params} page={page} pageSize={PAGE_SIZE} total={count ?? 0} />
        </>
      )}
    </>
  );
}

export default function MinistriesPage({ searchParams }: PageProps<"/ministries">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Ministries" description="The teams members serve in." variant="cards" />}>
      <MinistriesContent searchParams={searchParams} />
    </PageBoundary>
  );
}
