import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { HandHeart, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { deletePastoralCare, savePastoralCare } from "@/app/(app)/module-actions";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog, type FieldDef, type FormValues } from "@/components/shared/entity-dialog";
import { FilterBar } from "@/components/shared/filter-bar";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { StatusPill } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { cleanSearchTerm, getChurchSettings, getChurchToday, isUuid, getListParams } from "@/lib/data/common";
import { CARE_TYPES, CONFIDENTIALITY, getPeopleOptions, getUserOptions, labelOf } from "@/lib/data/options";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Pastoral Care" };

type CareRow = {
  id: string;
  person_id: string;
  person_name: string | null;
  care_type: string;
  care_date: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  summary: string;
  notes: string | null;
  follow_up_required: boolean;
  follow_up_date: string | null;
  confidentiality: string;
  created_by: string | null;
};

const TONE = { care_team: "neutral", selected_leaders: "warning", pastor_only: "danger" } as const;

async function PastoralContent({ searchParams }: Pick<PageProps<"/care/pastoral">, "searchParams">) {
  const access = await requireAccess();
  const { params, page, from, pageSize } = await getListParams(await searchParams);
  const canManage = can(access, "care.manage");
  const canConfidential = can(access, "care.confidential");

  const supabase = await createClient();
  // The query asks for everything; the database returns only the records this
  // user is allowed to read. Confidential rows never leave the server for others.
  let query = supabase.from("pastoral_care_details").select("*", { count: "exact" });
  if (isUuid(params.person)) query = query.eq("person_id", params.person);
  if (params.type) query = query.eq("care_type", params.type);
  if (params.level) query = query.eq("confidentiality", params.level);
  if (params.followup === "yes") query = query.eq("follow_up_required", true);
  const term = cleanSearchTerm(params.q);
  if (term) query = query.or(`person_name.ilike.%${term}%,summary.ilike.%${term}%`);

  const [list, people, users, settings, today] = await Promise.all([
    query.order("care_date", { ascending: false }).order("created_at", { ascending: false }).range(from, from + pageSize - 1),
    canManage ? getPeopleOptions() : [],
    canManage ? getUserOptions() : [],
    getChurchSettings(),
    getChurchToday(),
  ]);
  if (list.error) {
    console.error("Failed to load pastoral care", describeError(list.error));
    return <LoadError what="the care records" />;
  }
  const rows = (list.data ?? []) as CareRow[];
  if (rows.length === 0 && !canManage && !can(access, "care.view") && !canConfidential) {
    return <NoAccess />;
  }

  // Who each "Selected Leaders" record is shared with (readable only by its author).
  const shared: Record<string, string[]> = {};
  const selectedIds = rows.filter((row) => row.confidentiality === "selected_leaders").map((row) => row.id);
  if (selectedIds.length > 0) {
    const { data } = await supabase.from("pastoral_care_access").select("record_id, user_id").in("record_id", selectedIds);
    for (const row of data ?? []) {
      (shared[row.record_id] ??= []).push(row.user_id);
    }
  }

  const fields: FieldDef[] = [
    { name: "person_id", label: "Person", type: "select", options: people, emptyLabel: "Choose a person…", required: true, wide: true },
    { name: "care_type", label: "Care type", type: "select", options: [...CARE_TYPES] },
    { name: "care_date", label: "Date", type: "date", required: true },
    { name: "assigned_to", label: "Assigned pastor / leader", type: "select", options: users, emptyLabel: "Unassigned" },
    {
      name: "confidentiality",
      label: "Confidentiality",
      type: "select",
      options: [...CONFIDENTIALITY],
      hint: "Care Team: everyone with care access. Selected Leaders: only the people you tick. Pastor Only: you, the assignee and holders of confidential access.",
    },
    {
      name: "shared_with",
      label: "Share with these leaders",
      type: "multi",
      options: users.filter((user) => user.value !== access.userId),
      showWhen: { field: "confidentiality", in: ["selected_leaders"] },
    },
    { name: "summary", label: "Summary", type: "text", required: true, wide: true },
    { name: "notes", label: "Notes", type: "textarea" },
    { name: "follow_up_required", label: "Follow-up required", type: "switch" },
    { name: "follow_up_date", label: "Follow-up date", type: "date", showWhen: { field: "follow_up_required", in: ["true"] } },
  ];
  const valuesOf = (row?: CareRow): FormValues => ({
    person_id: row?.person_id ?? (isUuid(params.person) ? params.person : ""),
    care_type: row?.care_type ?? "counseling",
    care_date: row?.care_date ?? today,
    assigned_to: row?.assigned_to ?? access.userId,
    confidentiality: row?.confidentiality ?? "care_team",
    shared_with: row ? (shared[row.id] ?? []) : [],
    summary: row?.summary ?? "",
    notes: row?.notes ?? "",
    follow_up_required: row?.follow_up_required ?? false,
    follow_up_date: row?.follow_up_date ?? "",
  });

  const createButton = canManage ? (
    <EntityDialog
      title="New care record"
      description="Write only what the people who can read this record need to know."
      fields={fields}
      initial={valuesOf()}
      action={savePastoralCare.bind(null, null)}
      submitLabel="Save record"
      successMessage="Care record saved"
      defaultOpen={params.new === "1"}
    >
      <Plus /> New care record
    </EntityDialog>
  ) : null;
  const hasFilters = Object.keys(params).some((key) => key !== "page" && key !== "new");
  const focused = isUuid(params.person) ? rows[0]?.person_name : null;

  return (
    <>
      <PageHeader
        title={focused ? `Care history — ${focused}` : "Pastoral Care"}
        description="Sensitive records. You only see the ones shared with you."
        actions={createButton}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput params={params} placeholder="Search person or summary…" />
        <FilterBar params={params}>
          <FilterSelect params={params} paramKey="type" label="Care type" options={[...CARE_TYPES]} />
          <FilterSelect params={params} paramKey="level" label="Confidentiality" options={[...CONFIDENTIALITY]} />
          <FilterSelect params={params} paramKey="followup" label="Follow-up" options={[{ value: "yes", label: "Required" }]} />
        </FilterBar>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={HandHeart}
          title={hasFilters ? "No care records match these filters." : "No care records yet."}
          description={hasFilters ? undefined : "Records you create, are assigned, or are given access to appear here."}
          action={
            hasFilters ? (
              <Link href="/care/pastoral" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : (
              createButton
            )
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map((row) => {
              const mine = row.created_by === access.userId;
              return (
                <li key={row.id} className="rounded-xl border bg-card p-4 shadow-xs">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <Link href={`/care/pastoral?person=${row.person_id}`} className="hover:underline">
                          {row.person_name ?? "Person"}
                        </Link>
                        <span className="ml-2 font-normal text-muted-foreground">{labelOf(CARE_TYPES, row.care_type)}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(row.care_date, settings.date_format)}
                        {row.assigned_to_name ? ` · ${row.assigned_to_name}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {row.follow_up_required ? (
                        <StatusPill tone="brand">
                          Follow-up{row.follow_up_date ? ` ${formatDate(row.follow_up_date, settings.date_format)}` : ""}
                        </StatusPill>
                      ) : null}
                      <StatusPill tone={TONE[row.confidentiality as keyof typeof TONE] ?? "neutral"}>
                        <Lock className="mr-1 size-3" aria-hidden />
                        {labelOf(CONFIDENTIALITY, row.confidentiality)}
                      </StatusPill>
                      {canManage || mine ? (
                        <EntityDialog
                          title="Care record"
                          fields={fields}
                          initial={valuesOf(row)}
                          action={savePastoralCare.bind(null, row.id)}
                          successMessage="Care record updated"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Edit care record"
                        >
                          <Pencil />
                        </EntityDialog>
                      ) : null}
                      {mine || canConfidential ? (
                        <ConfirmButton
                          action={deletePastoralCare.bind(null, row.id)}
                          title="Delete this care record?"
                          description="The record and its notes are permanently removed. This can't be undone."
                          confirmLabel="Delete"
                          successMessage="Care record deleted"
                          destructive
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete care record"
                        >
                          <Trash2 />
                        </ConfirmButton>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-medium">{row.summary}</p>
                  {row.notes ? (
                    <details className="mt-2 text-sm">
                      <summary className="inline-flex min-h-9 cursor-pointer items-center text-link">Show notes</summary>
                      <p className="mt-1 whitespace-pre-line text-muted-foreground">{row.notes}</p>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Pagination params={params} page={page} pageSize={pageSize} total={list.count ?? 0} />
        </>
      )}
    </>
  );
}

export default function PastoralCarePage({ searchParams }: PageProps<"/care/pastoral">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Pastoral Care" description="Sensitive records. You only see the ones shared with you." />}>
      <PastoralContent searchParams={searchParams} />
    </PageBoundary>
  );
}
