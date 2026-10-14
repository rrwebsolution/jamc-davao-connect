import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { Cake } from "lucide-react";
import { FilterSelect } from "@/components/shared/list-controls";
import { PersonAvatar, StatusPill } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, getChurchToday, parseListParams, signPhotoUrls } from "@/lib/data/common";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Birthdays" };

type BirthdayRow = {
  id: string;
  full_name: string;
  photo_path: string | null;
  birthdate: string;
  next_birthday: string;
  turning_age: number;
};

const RANGES = [
  { value: "7", label: "Next 7 days" },
  { value: "90", label: "Next 90 days" },
  { value: "365", label: "Next 12 months" },
];

async function BirthdaysContent({ searchParams }: Pick<PageProps<"/people/birthdays">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.membersView, P.membersViewAssigned)) {
    return <NoAccess />;
  }

  const { params } = parseListParams(await searchParams);
  const days = RANGES.some((range) => range.value === params.days) ? Number(params.days) : 30;

  const supabase = await createClient();
  const [result, settings, today] = await Promise.all([
    supabase.rpc("upcoming_birthdays", { days_ahead: days }),
    getChurchSettings(),
    getChurchToday(),
  ]);
  const rows = (result.data ?? []) as BirthdayRow[];
  const photos = await signPhotoUrls(rows.map((row) => row.photo_path));

  return (
    <>
      <PageHeader title="Birthdays" description={`Members celebrating in the next ${days} days.`} />
      <div className="mb-4 sm:max-w-xs">
        <FilterSelect params={params} paramKey="days" label="Period" allLabel="Next 30 days" options={RANGES} />
      </div>
      {result.error ? (
        <LoadError what="the birthdays" />
      ) : rows.length === 0 ? (
        <EmptyState icon={Cake} title={`No birthdays in the next ${days} days.`} description="Birthdays come from the birthdate on each member's profile." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs">
              <PersonAvatar name={row.full_name} src={row.photo_path ? photos[row.photo_path] : null} className="size-11" />
              <div className="min-w-0 flex-1">
                <Link href={`/people/members/${row.id}`} className="block truncate font-medium hover:underline">
                  {row.full_name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {formatDate(row.next_birthday, settings.date_format)} · turning {row.turning_age}
                </p>
              </div>
              {row.next_birthday === today ? <StatusPill tone="brand">Today</StatusPill> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function BirthdaysPage({ searchParams }: PageProps<"/people/birthdays">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Birthdays" variant="cards" />}>
      <BirthdaysContent searchParams={searchParams} />
    </PageBoundary>
  );
}
