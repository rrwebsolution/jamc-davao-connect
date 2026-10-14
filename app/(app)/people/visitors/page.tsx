import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { Eye, Pencil, Plus, UserCheck, UserPlus } from "lucide-react";
import { convertVisitor } from "@/app/(app)/people/actions";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { FilterBar } from "@/components/shared/filter-bar";
import { FilterSelect, Pagination, SearchInput, SortLink } from "@/components/shared/list-controls";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { VisitorStatusPill } from "@/components/people/visitor-status";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, getListParams, signPhotoUrls } from "@/lib/data/common";
import { listPeople } from "@/lib/data/people";
import { formatDate } from "@/lib/format";
import { VISITOR_STATUSES, type Person } from "@/lib/types";

export const metadata: Metadata = { title: "Visitors" };

async function VisitorsContent({ searchParams }: Pick<PageProps<"/people/visitors">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.visitorsView)) {
    return <NoAccess />;
  }

  const { params, page, from, pageSize } = await getListParams(await searchParams);
  const [list, settings] = await Promise.all([listPeople("visitor", params, from), getChurchSettings()]);
  const photos = await signPhotoUrls(list.rows.map((row) => row.photo_path));

  const canCreate = can(access, P.visitorsCreate);
  const canEdit = can(access, P.visitorsUpdate);
  const canConvert = canEdit && can(access, P.membersCreate);
  const hasFilters = Object.keys(params).some((key) => !["page", "sort", "dir"].includes(key));

  const actions = (person: Person) => (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/people/visitors/${person.id}`}
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={`View ${person.full_name}`}
      >
        <Eye />
      </Link>
      {canEdit && !person.archived_at ? (
        <Link
          href={`/people/visitors/${person.id}/edit`}
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          aria-label={`Edit ${person.full_name}`}
        >
          <Pencil />
        </Link>
      ) : null}
      {canConvert && !person.archived_at ? (
        <ConfirmButton
          action={convertVisitor.bind(null, person.id)}
          title="Convert to member?"
          description={`${person.full_name} will become a member. Their details, attendance and visit history stay on the same record.`}
          confirmLabel="Convert to member"
          successMessage={`${person.full_name} is now a member`}
          redirectTo={`/people/members/${person.id}`}
          variant="ghost"
          size="icon-sm"
          aria-label={`Convert ${person.full_name} to member`}
        >
          <UserCheck />
        </ConfirmButton>
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Visitors"
        description="People who have visited and are being followed up."
        actions={
          canCreate ? (
            <Link href="/people/visitors/new" className={buttonVariants()}>
              <Plus /> Register visitor
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput params={params} placeholder="Search name, phone or email…" />
        <FilterBar params={params}>
          <FilterSelect
            params={params}
            paramKey="vstatus"
            label="Follow-up"
            options={VISITOR_STATUSES.filter((s) => s.value !== "became_member").map((s) => ({ value: s.value, label: s.label }))}
          />
          <FilterSelect params={params} paramKey="status" label="Show" options={[{ value: "archived", label: "Archived" }]} />
        </FilterBar>
      </div>

      {list.failed ? (
        <LoadError what="the visitors list" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title={hasFilters ? "No visitors found." : "No visitors registered yet."}
          description={hasFilters ? "Try a different search or clear the filters." : "Register a visitor after a service to start following them up."}
          action={
            hasFilters ? (
              <Link href="/people/visitors" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : canCreate ? (
              <Link href="/people/visitors/new" className={buttonVariants()}>
                <Plus /> Register visitor
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <ul data-reveal-list="" className="space-y-2 lg:hidden">
            {list.rows.map((person) => (
              <li key={person.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-start gap-3">
                  <PersonAvatar name={person.full_name} src={person.photo_path ? photos[person.photo_path] : null} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/people/visitors/${person.id}`} className="block truncate font-medium hover:underline">
                      {person.full_name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {[formatDate(person.first_visit_date, settings.date_format), person.contact_number].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-2">
                      <VisitorStatusPill status={person.visitor_status} />
                    </div>
                  </div>
                  {actions(person)}
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead>
                    <SortLink params={params} column="full_name">Full name</SortLink>
                  </TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>
                    <SortLink params={params} column="first_visit_date">First visit</SortLink>
                  </TableHead>
                  <TableHead>Service attended</TableHead>
                  <TableHead>Invited by</TableHead>
                  <TableHead>
                    <SortLink params={params} column="visitor_status">Follow-up status</SortLink>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell>
                      <PersonAvatar name={person.full_name} src={person.photo_path ? photos[person.photo_path] : null} className="size-8" />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/people/visitors/${person.id}`} className="hover:underline">
                        {person.full_name}
                      </Link>
                    </TableCell>
                    <TableCell>{person.contact_number ?? person.email ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(person.first_visit_date, settings.date_format)}</TableCell>
                    <TableCell>{person.service_attended ?? "—"}</TableCell>
                    <TableCell>{person.invited_by ?? "—"}</TableCell>
                    <TableCell>
                      <VisitorStatusPill status={person.visitor_status} />
                    </TableCell>
                    <TableCell>{actions(person)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Pagination params={params} page={page} pageSize={pageSize} total={list.total} />
        </>
      )}
    </>
  );
}

export default function VisitorsPage({ searchParams }: PageProps<"/people/visitors">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Visitors" description="People who have visited and are being followed up." />}>
      <VisitorsContent searchParams={searchParams} />
    </PageBoundary>
  );
}
