import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { Plus, UsersRound } from "lucide-react";
import { saveGroup } from "@/app/(app)/module-actions";
import { buttonVariants } from "@/components/ui/button";
import { formatTime } from "@/components/shared/blocks";
import { EntityDialog } from "@/components/shared/entity-dialog";
import { FilterBar } from "@/components/shared/filter-bar";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { StatusPill } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { cleanSearchTerm, PAGE_SIZE, parseListParams } from "@/lib/data/common";
import { groupFields, type GroupRow } from "@/lib/data/groups";
import { getPeopleOptions, WEEKDAYS } from "@/lib/data/options";
import { titleCase } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Cell Groups" };

async function GroupsContent({ searchParams }: Pick<PageProps<"/groups">, "searchParams">) {
  const access = await requireAccess();
  const { params, page, from } = parseListParams(await searchParams);
  const canManage = can(access, P.groupsManage);

  // No page-level gate: RLS returns all groups to group viewers, a leader's
  // own groups to cell leaders, and a member's own group to members.
  const supabase = await createClient();
  let query = supabase.from("cell_group_directory").select("*", { count: "exact" });
  if (params.status === "archived") query = query.not("archived_at", "is", null);
  else {
    query = query.is("archived_at", null);
    if (params.status === "active") query = query.eq("is_active", true);
    if (params.status === "inactive") query = query.eq("is_active", false);
  }
  if (params.day) query = query.eq("meeting_day", params.day);
  const term = cleanSearchTerm(params.q);
  if (term) query = query.or(`name.ilike.%${term}%,location.ilike.%${term}%`);

  const [{ data, count, error }, members] = await Promise.all([
    query.order("name").range(from, from + PAGE_SIZE - 1),
    canManage ? getPeopleOptions("member") : [],
  ]);
  if (error) {
    console.error("Failed to load cell groups", describeError(error));
    return <LoadError what="the cell groups" />;
  }
  const rows = (data ?? []) as GroupRow[];
  const hasFilters = Object.keys(params).some((key) => key !== "page" && key !== "new");

  const createButton = canManage ? (
    <EntityDialog
      title="New cell group"
      description="You can add members after creating the group."
      fields={groupFields(members)}
      initial={{ name: "", description: "", leader_id: "", assistant_leader_id: "", meeting_day: "", meeting_time: "", location: "", is_active: true }}
      action={saveGroup.bind(null, null)}
      submitLabel="Create group"
      successMessage="Cell group created"
      redirectOnCreate="/groups"
      defaultOpen={params.new === "1"}
    >
      <Plus /> New cell group
    </EntityDialog>
  ) : null;

  return (
    <>
      <PageHeader
        title="Cell Groups"
        description={can(access, P.groupsView) ? "Small groups that meet through the week." : "The cell groups you belong to or lead."}
        actions={createButton}
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput params={params} placeholder="Search by name or location…" />
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
          <FilterSelect params={params} paramKey="day" label="Meeting day" options={[...WEEKDAYS]} />
        </FilterBar>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={hasFilters ? "No cell groups match these filters." : "No cell groups yet."}
          description={hasFilters ? undefined : canManage ? "Create the first group, then add its members." : "You haven't been added to a cell group yet."}
          action={
            hasFilters ? (
              <Link href="/groups" className={buttonVariants({ variant: "outline" })}>
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
            {rows.map((group) => (
              <li key={group.id}>
                <Link href={`/groups/${group.id}`} className="block h-full rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-ring">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium">{group.name}</p>
                    {group.archived_at ? (
                      <StatusPill tone="danger">Archived</StatusPill>
                    ) : group.is_active ? (
                      <StatusPill tone="success">Active</StatusPill>
                    ) : (
                      <StatusPill>Inactive</StatusPill>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {group.leader_name ? `Led by ${group.leader_name}` : "No leader assigned"}
                  </p>
                  <p className="mt-3 text-sm">
                    <span className="font-semibold tabular-nums">{group.member_count}</span>{" "}
                    {group.member_count === 1 ? "member" : "members"}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {[group.meeting_day ? `${titleCase(group.meeting_day)}s` : null, formatTime(group.meeting_time), group.location]
                      .filter(Boolean)
                      .join(" · ") || "Meeting details not set"}
                  </p>
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

export default function GroupsPage({ searchParams }: PageProps<"/groups">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Cell Groups" variant="cards" />}>
      <GroupsContent searchParams={searchParams} />
    </PageBoundary>
  );
}
