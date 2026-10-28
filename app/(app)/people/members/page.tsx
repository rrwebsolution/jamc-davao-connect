import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { setPersonArchived } from "@/app/(app)/people/actions";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterBar } from "@/components/shared/filter-bar";
import { FilterSelect, Pagination, SearchInput, SortLink } from "@/components/shared/list-controls";
import { PersonAvatar, StatusPill } from "@/components/shared/person-avatar";
import { RowMenu } from "@/components/shared/row-menu";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, getLookup, getListParams, signPhotoUrls } from "@/lib/data/common";
import { getCellGroupOptions, listPeople } from "@/lib/data/people";
import { formatDate } from "@/lib/format";
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
    <RowMenu
      label={`Actions for ${person.full_name}`}
      items={[
        { label: "View profile", icon: "view", href: `/people/members/${person.id}` },
        ...(canEdit && !person.archived_at ? [{ label: "Edit", icon: "edit" as const, href: `/people/members/${person.id}/edit` }] : []),
        ...(canArchive
          ? [
              {
                label: person.archived_at ? "Restore" : "Archive",
                icon: person.archived_at ? ("restore" as const) : ("archive" as const),
                separated: true,
                confirm: {
                  action: setPersonArchived.bind(null, person.id, !person.archived_at),
                  title: person.archived_at ? "Restore this member?" : "Archive this member?",
                  description: person.archived_at
                    ? `${person.full_name} will appear in the members list again.`
                    : `${person.full_name} will be hidden from lists and counts. Their history is kept and they can be restored at any time.`,
                  confirmLabel: person.archived_at ? "Restore" : "Archive",
                  successMessage: person.archived_at ? "Member restored" : "Member archived",
                  destructive: !person.archived_at,
                },
              },
            ]
          : []),
      ]}
    />
  );
  const since = (person: Person) => (person.membership_date ? `Member since ${person.membership_date.slice(0, 4)}` : null);

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

      <div className="mb-4 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <SearchInput params={params} placeholder="Search name, ID, phone or email…" />
        <FilterBar params={params} inline={3}>
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
              <li key={person.id} className="relative rounded-xl border bg-card p-3.5 shadow-xs">
                <div className="flex items-start gap-3">
                  <PersonAvatar name={person.full_name} src={person.photo_path ? photos[person.photo_path] : null} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/people/members/${person.id}`} className="min-w-0 truncate font-medium after:absolute after:inset-0 after:rounded-xl">
                        {person.full_name}
                      </Link>
                      <MemberStatus person={person} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{[person.member_code, since(person)].filter(Boolean).join(" · ")}</p>
                    <p className="mt-1.5 truncate text-sm">
                      {[person.cell_group_name, person.ministry_names[0]].filter(Boolean).join(" · ") || <span className="text-muted-foreground">No group or ministry yet</span>}
                    </p>
                    {person.membership_status_name || person.discipleship_stage_name ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {person.membership_status_name ? <StatusPill>{person.membership_status_name}</StatusPill> : null}
                        {person.discipleship_stage_name ? <StatusPill tone="brand">{person.discipleship_stage_name}</StatusPill> : null}
                      </div>
                    ) : null}
                  </div>
                  {/* Above the card-wide link. */}
                  <div className="relative -mr-1 -mt-1">{actions(person)}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border bg-card shadow-xs lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <SortLink params={params} column="full_name">Member</SortLink>
                  </TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>
                    <SortLink params={params} column="cell_group_name">Cell group</SortLink>
                  </TableHead>
                  <TableHead>Ministry</TableHead>
                  <TableHead>Membership</TableHead>
                  <TableHead>
                    <SortLink params={params} column="membership_date">Joined</SortLink>
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <PersonAvatar name={person.full_name} src={person.photo_path ? photos[person.photo_path] : null} />
                        <div className="min-w-0">
                          <Link href={`/people/members/${person.id}`} className="block max-w-56 truncate font-medium hover:underline">
                            {person.full_name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            <span className="font-mono">{person.member_code ?? "No ID"}</span>
                            {since(person) ? ` · ${since(person)}` : null}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="block">{person.contact_number ?? "—"}</span>
                      {person.email ? <span className="block max-w-48 truncate text-xs text-muted-foreground">{person.email}</span> : null}
                    </TableCell>
                    <TableCell>{person.cell_group_name ?? "—"}</TableCell>
                    <TableCell>
                      <span className="block max-w-44 truncate" title={person.ministry_names.join(", ")}>
                        {person.ministry_names.join(", ") || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block">{person.membership_status_name ?? "—"}</span>
                      {person.discipleship_stage_name ? <span className="block text-xs text-muted-foreground">{person.discipleship_stage_name}</span> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(person.membership_date, settings.date_format)}</TableCell>
                    <TableCell>
                      <MemberStatus person={person} />
                    </TableCell>
                    <TableCell className="text-right">{actions(person)}</TableCell>
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
