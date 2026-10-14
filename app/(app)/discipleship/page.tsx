import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { Settings, Sprout } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { FilterBar } from "@/components/shared/filter-bar";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { PersonAvatar, StatusPill } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { cleanSearchTerm, getLookup, isUuid, getListParams, signPhotoUrls } from "@/lib/data/common";
import { createClient } from "@/lib/supabase/server";
import type { Person } from "@/lib/types";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Discipleship" };

async function DiscipleshipContent({ searchParams }: Pick<PageProps<"/discipleship">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.discipleshipView, "discipleship.view_assigned")) {
    return <NoAccess />;
  }
  const { params, page, from, pageSize } = await getListParams(await searchParams);
  const supabase = await createClient();

  let query = supabase
    .from("people_directory")
    .select("*", { count: "exact" })
    .eq("person_type", "member")
    .is("archived_at", null);
  if (params.stage === "none") query = query.is("discipleship_stage_id", null);
  else if (isUuid(params.stage)) query = query.eq("discipleship_stage_id", params.stage);
  if (params.mentor === "none") query = query.is("mentor_id", null);
  else if (params.mentor === "has") query = query.not("mentor_id", "is", null);
  const term = cleanSearchTerm(params.q);
  if (term) query = query.or(`full_name.ilike.%${term}%,mentor_name.ilike.%${term}%`);

  const [list, stages, everyone] = await Promise.all([
    query.order("full_name").range(from, from + pageSize - 1),
    getLookup("discipleship_stages"),
    supabase
      .from("people")
      .select("discipleship_stage_id, mentor_id")
      .eq("person_type", "member")
      .is("archived_at", null)
      .limit(10000),
  ]);
  if (list.error) {
    console.error("Failed to load discipleship list", describeError(list.error));
    return <LoadError what="the discipleship list" />;
  }
  const rows = (list.data ?? []) as Person[];
  const photos = await signPhotoUrls(rows.map((row) => row.photo_path));

  const all = everyone.data ?? [];
  const perStage = new Map<string, number>();
  for (const person of all) {
    if (person.discipleship_stage_id) {
      perStage.set(person.discipleship_stage_id, (perStage.get(person.discipleship_stage_id) ?? 0) + 1);
    }
  }
  const unstaged = all.filter((person) => !person.discipleship_stage_id).length;
  const mentored = all.filter((person) => person.mentor_id).length;
  const busiest = Math.max(1, ...perStage.values());
  const hasFilters = Object.keys(params).some((key) => key !== "page");

  return (
    <>
      <PageHeader
        title="Discipleship"
        description="Where each member is on the growth path, and who is walking with them."
        actions={
          can(access, P.discipleshipManage, P.settingsManage) ? (
            <Link href="/admin/settings" className={buttonVariants({ variant: "outline" })}>
              <Settings /> Manage stages
            </Link>
          ) : null
        }
      />

      <section className="mb-4 rounded-xl border bg-card p-4 shadow-xs">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Growth path</h2>
          <p className="text-sm text-muted-foreground">
            {all.length} members · {mentored} with a mentor · {unstaged} without a stage
          </p>
        </div>
        {stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stages are set up yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {stages.map((stage, index) => {
              const members = perStage.get(stage.id) ?? 0;
              return (
                <li key={stage.id}>
                  <Link href={`/discipleship?stage=${stage.id}`} className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-accent">
                    <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <span className="w-36 shrink-0 truncate sm:w-44">{stage.name}</span>
                    <span className="h-2 flex-1 rounded-full bg-muted">
                      <span className="block h-2 rounded-full bg-chart-1" style={{ width: `${(members / busiest) * 100}%` }} />
                    </span>
                    <span className="w-8 text-right tabular-nums">{members}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput params={params} placeholder="Search member or mentor…" />
        <FilterBar params={params}>
          <FilterSelect
            params={params}
            paramKey="stage"
            label="Stage"
            options={[...stages.map((stage) => ({ value: stage.id, label: stage.name })), { value: "none", label: "No stage yet" }]}
          />
          <FilterSelect
            params={params}
            paramKey="mentor"
            label="Mentor"
            options={[
              { value: "has", label: "Has a mentor" },
              { value: "none", label: "No mentor" },
            ]}
          />
        </FilterBar>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title={hasFilters ? "No members match these filters." : "No members to show yet."}
          action={
            hasFilters ? (
              <Link href="/discipleship" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-card">
            {rows.map((person) => (
              <li key={person.id}>
                <Link href={`/discipleship/${person.id}`} className="flex items-center gap-3 p-3 hover:bg-accent">
                  <PersonAvatar name={person.full_name} src={person.photo_path ? photos[person.photo_path] : null} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{person.full_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {person.mentor_name ? `Mentor: ${person.mentor_name}` : "No mentor"}
                      {person.cell_group_name ? ` · ${person.cell_group_name}` : ""}
                    </span>
                  </span>
                  {person.discipleship_stage_name ? (
                    <StatusPill tone="brand">{person.discipleship_stage_name}</StatusPill>
                  ) : (
                    <StatusPill>No stage</StatusPill>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <Pagination params={params} page={page} pageSize={pageSize} total={list.count ?? 0} />
        </>
      )}
    </>
  );
}

export default function DiscipleshipPage({ searchParams }: PageProps<"/discipleship">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Discipleship" description="Where each member is on the growth path, and who is walking with them." />}>
      <DiscipleshipContent searchParams={searchParams} />
    </PageBoundary>
  );
}
