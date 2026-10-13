import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { AttendanceSummary } from "@/components/attendance/attendance-summary";
import { SearchInput } from "@/components/shared/list-controls";
import { EmptyState, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { cleanSearchTerm, getChurchSettings, parseListParams } from "@/lib/data/common";
import { getPerson } from "@/lib/data/people";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Attendance History" };

async function HistoryContent({ searchParams }: Pick<PageProps<"/attendance/history">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.attendanceView, P.attendanceViewAssigned)) {
    return <NoAccess />;
  }

  const { params } = parseListParams(await searchParams);
  const settings = await getChurchSettings();

  if (params.person) {
    const person = await getPerson(params.person);
    if (!person) {
      return <EmptyState title="That person could not be found." description="They may have been removed, or you may not have access to them." />;
    }
    return (
      <>
        <Link href="/attendance/history" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Choose another person
        </Link>
        <PageHeader
          title={person.full_name}
          description={person.person_type === "member" ? [person.member_code, person.cell_group_name].filter(Boolean).join(" · ") : "Visitor"}
        />
        <AttendanceSummary personId={person.id} dateFormat={settings.date_format} threshold={settings.absence_threshold} />
      </>
    );
  }

  const term = cleanSearchTerm(params.q);
  const supabase = await createClient();
  let query = supabase
    .from("people")
    .select("id, full_name, person_type, member_code")
    .is("archived_at", null)
    .order("full_name")
    .limit(30);
  if (term) {
    query = query.or(`full_name.ilike.%${term}%,member_code.ilike.%${term}%`);
  }
  const { data: people } = await query;

  return (
    <>
      <PageHeader title="Attendance History" description="Choose a person to see their attendance record and statistics." />
      <div className="mb-4">
        <SearchInput params={params} placeholder="Search by name or member ID…" />
      </div>
      {(people ?? []).length === 0 ? (
        <EmptyState icon={History} title={term ? `No one matches “${term}”.` : "No people to show yet."} />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {(people ?? []).map((person) => (
            <li key={person.id}>
              <Link
                href={`/attendance/history?person=${person.id}`}
                className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-accent"
              >
                <span className="truncate font-medium">{person.full_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {person.person_type === "visitor" ? "Visitor" : (person.member_code ?? "Member")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(people ?? []).length === 30 ? (
        <p className="mt-3 text-xs text-muted-foreground">Showing the first 30. Search to narrow it down.</p>
      ) : null}
    </>
  );
}

export default function HistoryPage({ searchParams }: PageProps<"/attendance/history">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Attendance History" />}>
      <HistoryContent searchParams={searchParams} />
    </PageBoundary>
  );
}
