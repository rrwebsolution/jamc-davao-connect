import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { HeartHandshake, Plus } from "lucide-react";
import { saveFollowUp } from "@/app/(app)/module-actions";
import { followUpFields, FollowUpRows, followUpValues, type FollowUpRow } from "@/components/care/follow-up-list";
import { buttonVariants } from "@/components/ui/button";
import { StatTile } from "@/components/shared/blocks";
import { EntityDialog } from "@/components/shared/entity-dialog";
import { FilterBar } from "@/components/shared/filter-bar";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { EmptyState, LoadError, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { cleanSearchTerm, getChurchSettings, getChurchToday, isUuid, getListParams } from "@/lib/data/common";
import { FOLLOW_UP_STATUSES, FOLLOW_UP_TYPES, getPeopleOptions, getUserOptions, PRIORITIES } from "@/lib/data/options";
import { createClient } from "@/lib/supabase/server";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Follow-ups" };

async function FollowUpsContent({ searchParams }: Pick<PageProps<"/care/follow-ups">, "searchParams">) {
  const access = await requireAccess();
  const { params, page, from, pageSize } = await getListParams(await searchParams);
  const canCreate = can(access, "care.manage", "care.manage_assigned");

  // No page gate: anyone may have a follow-up assigned to them. RLS returns
  // all of them to care staff, a leader's group's, or only your own.
  const supabase = await createClient();
  const [today, settings, people, users] = await Promise.all([
    getChurchToday(),
    getChurchSettings(),
    getPeopleOptions(),
    getUserOptions(),
  ]);

  let query = supabase.from("follow_up_details").select("*", { count: "exact" });
  if (isUuid(params.focus)) {
    query = query.eq("id", params.focus);
  } else {
    // Default view: what still needs doing. "all" and the closed states show history.
    if (!params.status) query = query.in("status", ["pending", "in_progress"]);
    else if (params.status !== "all") query = query.eq("status", params.status);
    if (params.assigned === "me") query = query.eq("assigned_to", access.userId);
    else if (params.assigned === "none") query = query.is("assigned_to", null);
    else if (isUuid(params.assigned)) query = query.eq("assigned_to", params.assigned);
    if (params.priority) query = query.eq("priority", params.priority);
    if (params.type) query = query.eq("follow_up_type", params.type);
    if (params.due) query = query.eq("due_state", params.due);
    const term = cleanSearchTerm(params.q);
    if (term) query = query.or(`person_name.ilike.%${term}%,reason.ilike.%${term}%`);
  }

  const openStates = ["pending", "in_progress"];
  const [list, overdue, dueToday, upcoming] = await Promise.all([
    query.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).range(from, from + pageSize - 1),
    supabase.from("follow_ups").select("id", { count: "exact", head: true }).in("status", openStates).lt("due_date", today),
    supabase.from("follow_ups").select("id", { count: "exact", head: true }).in("status", openStates).eq("due_date", today),
    supabase.from("follow_ups").select("id", { count: "exact", head: true }).in("status", openStates).gt("due_date", today),
  ]);
  if (list.error) {
    console.error("Failed to load follow-ups", describeError(list.error));
    return <LoadError what="the follow-ups" />;
  }
  const rows = (list.data ?? []) as FollowUpRow[];
  const hasFilters = Object.keys(params).some((key) => key !== "page" && key !== "new");

  const createButton = canCreate ? (
    <EntityDialog
      title="New follow-up"
      fields={followUpFields(people, users)}
      initial={followUpValues({ assigned_to: access.userId })}
      action={saveFollowUp.bind(null, null)}
      submitLabel="Create follow-up"
      successMessage="Follow-up created"
      defaultOpen={params.new === "1"}
    >
      <Plus /> New follow-up
    </EntityDialog>
  ) : null;

  return (
    <>
      <PageHeader title="Follow-ups" description="Calls, visits and messages that someone has promised to make." actions={createButton} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Link href="/care/follow-ups?due=overdue">
          <StatTile label="Overdue" value={overdue.count ?? 0} note="Past their due date" />
        </Link>
        <Link href="/care/follow-ups?due=today">
          <StatTile label="Due today" value={dueToday.count ?? 0} />
        </Link>
        <Link href="/care/follow-ups?due=upcoming">
          <StatTile label="Upcoming" value={upcoming.count ?? 0} note="Due after today" />
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput params={params} placeholder="Search person or reason…" />
        <FilterBar params={params}>
          <FilterSelect
            params={params}
            paramKey="status"
            label="Status"
            allLabel="Status: Open"
            options={[...FOLLOW_UP_STATUSES, { value: "all", label: "All (with history)" }]}
          />
          <FilterSelect
            params={params}
            paramKey="assigned"
            label="Assigned to"
            options={[{ value: "me", label: "Me" }, { value: "none", label: "Unassigned" }, ...users]}
          />
          <FilterSelect params={params} paramKey="priority" label="Priority" options={[...PRIORITIES]} />
          <FilterSelect params={params} paramKey="type" label="Type" options={[...FOLLOW_UP_TYPES]} />
          <FilterSelect
            params={params}
            paramKey="due"
            label="Due"
            options={[
              { value: "overdue", label: "Overdue" },
              { value: "today", label: "Due today" },
              { value: "upcoming", label: "Upcoming" },
              { value: "no_date", label: "No due date" },
            ]}
          />
        </FilterBar>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={HeartHandshake}
          title={hasFilters ? "No follow-ups match these filters." : "No pending follow-ups."}
          description={hasFilters ? undefined : "Completed follow-ups stay in the history: choose Status → All."}
          action={
            hasFilters ? (
              <Link href="/care/follow-ups" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : (
              createButton
            )
          }
        />
      ) : (
        <>
          <div className="rounded-xl border bg-card">
            <FollowUpRows rows={rows} dateFormat={settings.date_format} edit={{ people, users }} />
          </div>
          {isUuid(params.focus) ? (
            <p className="mt-3 text-sm">
              <Link href="/care/follow-ups" className="text-link hover:underline">
                Show all follow-ups
              </Link>
            </p>
          ) : (
            <Pagination params={params} page={page} pageSize={pageSize} total={list.count ?? 0} />
          )}
        </>
      )}
    </>
  );
}

export default function FollowUpsPage({ searchParams }: PageProps<"/care/follow-ups">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Follow-ups" description="Calls, visits and messages that someone has promised to make." />}>
      <FollowUpsContent searchParams={searchParams} />
    </PageBoundary>
  );
}
