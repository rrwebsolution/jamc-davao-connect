import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { Archive, ArchiveRestore, Eye, Pencil, Plus, Users } from "lucide-react";
import { setPersonArchived } from "@/app/(app)/people/actions";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { FilterBar } from "@/components/shared/filter-bar";
import { FilterSelect, Pagination, SearchInput, SortLink } from "@/components/shared/list-controls";
import { PersonAvatar, StatusPill } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, getLookup, getListParams, signPhotoUrls } from "@/lib/data/common";
import { getCellGroupOptions, listPeople } from "@/lib/data/people";
import { formatDate, titleCase } from "@/lib/format";
import type { Person } from "@/lib/types";

export const metadata: Metadata = { title: "Members" };

function MemberStatus({ person }: { person: Person }) {
  if (person.archived_at) return <StatusPill tone="danger">Archived</StatusPill>;
  return person.is_active ? <StatusPill tone="success">Active</StatusPill> : <StatusPill>Inactive</StatusPill>;
}

async function MembersContent({ searchParams }: Pick<PageProps<"/people/members">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.membersView, P.membersViewAssigned)) {
    return <NoAccess />;
  }

  const { params, page, from, pageSize } = await getListParams(await searchParams);
  const [list, groups, ministries, statuses, stages, settings] = await Promise.all([
    listPeople("member", params, from),
    getCellGroupOptions(),
    getLookup("ministries"),
    getLookup("membership_statuses"),
    getLookup("discipleship_stages"),
    getChurchSettings(),
  ]);
  const photos = await signPhotoUrls(list.rows.map((row) => row.photo_path));

  const canCreate = can(access, P.membersCreate);
  const canEdit = can(access, P.membersUpdate);
  const canArchive = can(access, P.membersArchive) && canEdit;
  const hasFilters = Object.keys(params).some((key) => !["page", "sort", "dir"].includes(key));

  const actions = (person: Person) => (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/people/members/${person.id}`}
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={`View ${person.full_name}`}
      >
        <Eye />
      </Link>
      {canEdit && !person.archived_at ? (
        <Link
          href={`/people/members/${person.id}/edit`}
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          aria-label={`Edit ${person.full_name}`}
        >
          <Pencil />
        </Link>
      ) : null}
      {canArchive ? (
        <ConfirmButton
          action={setPersonArchived.bind(null, person.id, !person.archived_at)}
          title={person.archived_at ? "Restore this member?" : "Archive this member?"}
          description={
            person.archived_at
              ? `${person.full_name} will appear in the members list again.`
              : `${person.full_name} will be hidden from lists and counts. Their history is kept and they can be restored at any time.`
          }
          confirmLabel={person.archived_at ? "Restore" : "Archive"}
          successMessage={person.archived_at ? "Member restored" : "Member archived"}
          destructive={!person.archived_at}
          variant="ghost"
          size="icon-sm"
          aria-label={`${person.archived_at ? "Restore" : "Archive"} ${person.full_name}`}
        >
          {person.archived_at ? <ArchiveRestore /> : <Archive />}
        </ConfirmButton>
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Members"
        description={
          can(access, P.membersView) ? "Everyone who belongs to the church." : "Members of the cell groups you lead."
        }
        actions={
          canCreate ? (
            <Link href="/people/members/new" className={buttonVariants()}>
              <Plus /> Add member
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput params={params} placeholder="Search name, ID, phone or email…" />
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
          <FilterSelect params={params} paramKey="group" label="Cell group" options={groups.map((g) => ({ value: g.id, label: g.name }))} />
          <FilterSelect params={params} paramKey="ministry" label="Ministry" options={ministries.map((m) => ({ value: m.id, label: m.name }))} />
          <FilterSelect
            params={params}
            paramKey="gender"
            label="Gender"
            options={[
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
            ]}
          />
          <FilterSelect params={params} paramKey="membership" label="Membership" options={statuses.map((s) => ({ value: s.id, label: s.name }))} />
          <FilterSelect params={params} paramKey="stage" label="Stage" options={stages.map((s) => ({ value: s.id, label: s.name }))} />
        </FilterBar>
      </div>

      {list.failed ? (
        <LoadError what="the members list" />
      ) : list.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members found."
          description={hasFilters ? "Try a different search or clear the filters." : "Add your first member to get started."}
          action={
            hasFilters ? (
              <Link href="/people/members" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : canCreate ? (
              <Link href="/people/members/new" className={buttonVariants()}>
                <Plus /> Add member
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          {/* Phones and small tablets: one card per member. */}
          <ul data-reveal-list="" className="space-y-2 lg:hidden">
            {list.rows.map((person) => (
              <li key={person.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-start gap-3">
                  <PersonAvatar name={person.full_name} src={person.photo_path ? photos[person.photo_path] : null} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/people/members/${person.id}`} className="block truncate font-medium hover:underline">
                      {person.full_name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {[person.member_code, person.cell_group_name, person.contact_number].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <MemberStatus person={person} />
                      {person.membership_status_name ? <StatusPill>{person.membership_status_name}</StatusPill> : null}
                      {person.discipleship_stage_name ? <StatusPill tone="brand">{person.discipleship_stage_name}</StatusPill> : null}
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
                    <SortLink params={params} column="member_code">Member ID</SortLink>
                  </TableHead>
                  <TableHead>
                    <SortLink params={params} column="full_name">Full name</SortLink>
                  </TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>
                    <SortLink params={params} column="cell_group_name">Cell group</SortLink>
                  </TableHead>
                  <TableHead>Membership</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Ministry</TableHead>
                  <TableHead>
                    <SortLink params={params} column="membership_date">Date joined</SortLink>
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell>
                      <PersonAvatar name={person.full_name} src={person.photo_path ? photos[person.photo_path] : null} className="size-8" />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{person.member_code ?? "—"}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/people/members/${person.id}`} className="hover:underline">
                        {person.full_name}
                      </Link>
                    </TableCell>
                    <TableCell>{person.gender ? titleCase(person.gender) : "—"}</TableCell>
                    <TableCell>{person.contact_number ?? "—"}</TableCell>
                    <TableCell>{person.cell_group_name ?? "—"}</TableCell>
                    <TableCell>{person.membership_status_name ?? "—"}</TableCell>
                    <TableCell>{person.discipleship_stage_name ?? "—"}</TableCell>
                    <TableCell>{person.ministry_names.join(", ") || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(person.membership_date, settings.date_format)}</TableCell>
                    <TableCell>
                      <MemberStatus person={person} />
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

export default function MembersPage({ searchParams }: PageProps<"/people/members">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Members" />}>
      <MembersContent searchParams={searchParams} />
    </PageBoundary>
  );
}
