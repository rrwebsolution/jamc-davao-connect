import type { Metadata } from "next";
import Link from "next/link";
import { UserCheck, UserRoundCheck, UserRoundX } from "lucide-react";
import { approveRegistration, rejectRegistration } from "@/app/(app)/admin/actions";
import { PageBoundary } from "@/components/app/page-boundary";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Detail } from "@/components/shared/blocks";
import { EntityDialog, type FieldDef } from "@/components/shared/entity-dialog";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { StatusPill } from "@/components/shared/person-avatar";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { cleanSearchTerm, getChurchSettings, getListParams } from "@/lib/data/common";
import { describeError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account Approvals" };

const DESCRIPTION = "People who registered themselves and are waiting for an administrator.";

type Applicant = {
  id: string;
  email: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  mobile_number: string | null;
  is_existing_member: boolean;
  member_hint: string | null;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  created_at: string;
};

const TONE = { pending: "warning", approved: "success", rejected: "danger" } as const;
const LABEL = { pending: "Pending Approval", approved: "Approved", rejected: "Not approved" } as const;

async function ApprovalsContent({ searchParams }: Pick<PageProps<"/admin/approvals">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, P.usersManage)) {
    return <NoAccess />;
  }
  const { params, page, from, pageSize } = await getListParams(await searchParams);
  const status = ["rejected", "approved"].includes(params.status ?? "") ? (params.status as "rejected" | "approved") : "pending";

  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select("id, email, full_name, first_name, last_name, mobile_number, is_existing_member, member_hint, approval_status, rejection_reason, created_at", { count: "exact" })
    .eq("registration_source", "self_signup")
    .eq("approval_status", status);
  const term = cleanSearchTerm(params.q);
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,mobile_number.ilike.%${term}%`);

  const [list, roles, members, settings] = await Promise.all([
    query.order("created_at", { ascending: status !== "pending" ? false : true }).range(from, from + pageSize - 1),
    // Only the roles this admin is allowed to hand out.
    supabase.rpc("assignable_roles"),
    // Members without a login yet. Shown to the admin only, never to applicants.
    supabase
      .from("people_directory")
      .select("id, full_name, first_name, last_name, member_code, cell_group_name, email, contact_number")
      .eq("person_type", "member")
      .is("user_id", null)
      .is("archived_at", null)
      .order("full_name")
      .limit(2000),
    getChurchSettings(),
  ]);
  if (list.error) {
    console.error("Failed to load registrations", describeError(list.error));
    return <LoadError what="the registrations" />;
  }
  const rows = (list.data ?? []) as Applicant[];
  const roleOptions = ((roles.data ?? []) as { id: string; key: string; name: string }[]).map((role) => ({ value: role.id, label: role.name }));
  const memberRole = ((roles.data ?? []) as { id: string; key: string }[]).find((role) => role.key === "member")?.id ?? roleOptions[0]?.value ?? "";
  const memberOptions = (members.data ?? []).map((person) => ({
    value: person.id,
    label: person.member_code ? `${person.full_name} · ${person.member_code}` : person.full_name,
  }));

  // Suggestions only: an administrator decides. Nothing is linked by name alone.
  const digits = (value: string | null) => (value ?? "").replace(/\D/g, "").slice(-10);
  const same = (a: string | null, b: string | null) => Boolean(a && b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();
  const matchesFor = (applicant: Applicant) =>
    (members.data ?? [])
      .map((person) => {
        const reasons = [
          same(person.email, applicant.email) ? "same email" : null,
          digits(applicant.mobile_number).length >= 7 && digits(person.contact_number) === digits(applicant.mobile_number) ? "same mobile number" : null,
          same(person.last_name, applicant.last_name) && same(person.first_name, applicant.first_name) ? "same name" : null,
        ].filter(Boolean) as string[];
        return { person, reasons };
      })
      .filter((match) => match.reasons.length > 0)
      .slice(0, 5);

  const approveFields = (applicant: Applicant): FieldDef[] => [
    { name: "role_id", label: "Role", type: "select", options: roleOptions, required: true, wide: true, hint: "Approval lets them in; the role decides what they can see and do." },
    {
      name: "member_action",
      label: "Member record",
      type: "select",
      wide: true,
      options: [
        ...matchesFor(applicant).map(({ person }) => ({
          value: `match:${person.id}`,
          label: `Link possible match: ${person.full_name}${person.cell_group_name ? ` · ${person.cell_group_name}` : ""}`,
        })),
        { value: "link", label: "Link to another existing member" },
        { value: "create", label: "Create a new member record" },
        { value: "none", label: "Approve without a member record" },
      ],
      hint: "The account becomes the login of this member. Linking an existing member never creates a duplicate.",
    },
    {
      name: "link_person_id",
      label: "Existing member",
      type: "select",
      options: memberOptions,
      emptyLabel: "Search and choose a member…",
      required: true,
      wide: true,
      showWhen: { field: "member_action", in: ["link"] },
      hint: "Check it is the same person. Accounts are never matched by name automatically.",
    },
  ];

  const info = (applicant: Applicant) => (
    <dl className="mb-4 grid grid-cols-1 gap-3 rounded-lg border bg-muted/40 p-3 sm:grid-cols-2">
      <Detail label="Name">{applicant.full_name}</Detail>
      <Detail label="Email">{applicant.email}</Detail>
      <Detail label="Mobile number">{applicant.mobile_number}</Detail>
      <Detail label="Registered">{formatDateTime(applicant.created_at, settings.timezone)}</Detail>
      <div className="sm:col-span-2">
        <Detail label="Existing member?">
          {applicant.is_existing_member ? `Says yes${applicant.member_hint ? ` — “${applicant.member_hint}”` : ""}` : "Says no"}
        </Detail>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs text-muted-foreground">Possible member matches</dt>
        <dd className="mt-1 text-sm">
          {matchesFor(applicant).length === 0 ? (
            "None found by email, mobile number or name. Search the members list, or create a new member record."
          ) : (
            <ul className="space-y-1">
              {matchesFor(applicant).map(({ person, reasons }) => (
                <li key={person.id}>
                  <span className="font-medium">{person.full_name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {[person.cell_group_name ?? "No cell group", person.member_code].filter(Boolean).join(" · ")} ({reasons.join(", ")})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </div>
    </dl>
  );

  const actions = (applicant: Applicant) =>
    applicant.approval_status === "approved" ? null : (
      <div className="flex flex-wrap justify-end gap-2">
        <EntityDialog
          title="Review registration"
          description="Approve this account? The user will be able to sign in and use the system according to the assigned role and permissions."
          header={info(applicant)}
          fields={approveFields(applicant)}
          initial={{ role_id: memberRole, member_action: applicant.is_existing_member || matchesFor(applicant).length > 0 ? "link" : "create", link_person_id: "" }}
          action={approveRegistration.bind(null, applicant.id)}
          submitLabel="Approve Account"
          successMessage={`${applicant.full_name || applicant.email} was approved`}
          size="sm"
        >
          <UserRoundCheck /> Review
        </EntityDialog>
        {applicant.approval_status === "pending" ? (
          <EntityDialog
            title="Reject registration"
            description="They will not be able to use the system. They are told only that the registration was not approved."
            header={info(applicant)}
            fields={[
              {
                name: "reason",
                label: "Reason / notes (internal)",
                type: "textarea",
                placeholder: "e.g. Unable to verify church membership.",
                hint: "Kept for administrators. Never shown to the applicant.",
              },
            ]}
            initial={{ reason: "" }}
            action={rejectRegistration.bind(null, applicant.id)}
            submitLabel="Reject"
            successMessage="Registration rejected"
            variant="outline"
            size="sm"
          >
            <UserRoundX /> Reject
          </EntityDialog>
        ) : null}
      </div>
    );

  return (
    <>
      <PageHeader title="Account Approvals" description={DESCRIPTION} />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput params={params} placeholder="Search name, email or mobile…" />
        <div className="sm:w-56">
          <FilterSelect
            params={params}
            paramKey="status"
            label="Status"
            allLabel="Pending approval"
            options={[
              { value: "rejected", label: "Not approved" },
              { value: "approved", label: "Approved" },
            ]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title={status === "pending" ? "No registrations waiting for approval." : "Nothing here."}
          description={status === "pending" ? "New sign-ups appear here, and you are notified when one arrives." : undefined}
          action={
            params.q || params.status ? (
              <Link href="/admin/approvals" className={buttonVariants({ variant: "outline" })}>
                Back to pending
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          {/* Phones and tablets: one card per registration. */}
          <ul data-reveal-list="" className="space-y-3 lg:hidden">
            {rows.map((applicant) => (
              <li key={applicant.id} className="rounded-xl border bg-card p-4 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate font-medium">{applicant.full_name || applicant.email}</p>
                  <StatusPill tone={TONE[applicant.approval_status]}>{LABEL[applicant.approval_status]}</StatusPill>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{applicant.email}</p>
                {applicant.mobile_number ? <p className="truncate text-sm text-muted-foreground">{applicant.mobile_number}</p> : null}
                <p className="mt-2 text-xs text-muted-foreground">Registered: {formatDateTime(applicant.created_at, settings.timezone)}</p>
                {applicant.is_existing_member ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Existing member{applicant.member_hint ? `: “${applicant.member_hint}”` : ""}
                  </p>
                ) : null}
                {applicant.rejection_reason ? <p className="mt-1 text-xs text-muted-foreground">Internal note: {applicant.rejection_reason}</p> : null}
                <div className="mt-3">{actions(applicant)}</div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border bg-card lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Requested member match</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((applicant) => (
                  <TableRow key={applicant.id}>
                    <TableCell className="font-medium">{applicant.full_name || "—"}</TableCell>
                    <TableCell>{applicant.email}</TableCell>
                    <TableCell>{applicant.mobile_number ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(applicant.created_at, settings.timezone)}</TableCell>
                    <TableCell className="max-w-56 whitespace-normal">
                      {applicant.is_existing_member ? applicant.member_hint || "Yes" : "—"}
                      {applicant.rejection_reason ? <span className="block text-xs text-muted-foreground">Internal note: {applicant.rejection_reason}</span> : null}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={TONE[applicant.approval_status]}>{LABEL[applicant.approval_status]}</StatusPill>
                    </TableCell>
                    <TableCell>{actions(applicant)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination params={params} page={page} pageSize={pageSize} total={list.count ?? 0} />
        </>
      )}
    </>
  );
}

export default function ApprovalsPage({ searchParams }: PageProps<"/admin/approvals">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Account Approvals" description={DESCRIPTION} />}>
      <ApprovalsContent searchParams={searchParams} />
    </PageBoundary>
  );
}
