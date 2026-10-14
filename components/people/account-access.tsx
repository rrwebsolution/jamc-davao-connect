import Link from "next/link";
import { KeyRound, Mail, MailPlus, ShieldCheck, UserCheck, UserPlus, UserX } from "lucide-react";
import {
  changeLoginEmail,
  createMemberAccount,
  resendInvitation,
  saveAccountRoles,
  sendPasswordReset,
  setUserActive,
} from "@/app/(app)/admin/actions";
import { buttonVariants } from "@/components/ui/button";
import { Detail } from "@/components/shared/blocks";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog, type FieldDef, type FieldOption } from "@/components/shared/entity-dialog";
import { StatusPill } from "@/components/shared/person-avatar";
import { formatDateTime } from "@/lib/format";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type MemberAccount = {
  user_id: string;
  email: string;
  approval_status: "pending" | "approved" | "rejected";
  account_status: "pending" | "active" | "suspended" | "disabled";
  is_active: boolean;
  registration_source: "self_signup" | "admin_created" | "invited";
  created_at: string;
  approved_at: string | null;
  approved_by_name: string | null;
  last_sign_in_at: string | null;
  role_ids: string[];
  role_names: string[];
};

/** The login linked to a member, if any. Empty for anyone who does not manage users. */
export async function getMemberAccount(personId: string): Promise<MemberAccount | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("account_directory").eq("person_id", personId).maybeSingle();
  return (data as MemberAccount | null) ?? null;
}

const SOURCE = { self_signup: "Signed up, then approved", admin_created: "Created by an administrator", invited: "Invited by email" } as const;

export function accountStatus(account: Pick<MemberAccount, "approval_status" | "account_status" | "is_active">) {
  if (account.approval_status === "pending") return { label: "Pending approval", tone: "warning" } as const;
  if (account.approval_status === "rejected") return { label: "Not approved", tone: "danger" } as const;
  if (account.is_active) return { label: "Active", tone: "success" } as const;
  return { label: account.account_status === "disabled" ? "Disabled" : "Suspended", tone: "danger" } as const;
}

/** The fields asked for when a member gets a login. Everything else comes from the member record. */
export function accountFields(roles: FieldOption[]): FieldDef[] {
  return [
    {
      name: "email",
      label: "Login email",
      type: "text",
      required: true,
      wide: true,
      placeholder: "name@example.com",
      hint: "What they sign in with. It can differ from the contact email on the member record.",
    },
    { name: "role_id", label: "Role", type: "select", options: roles, required: true, wide: true, hint: "The role decides what they can see and do." },
    {
      name: "method",
      label: "How they get their password",
      type: "select",
      wide: true,
      options: [
        { value: "invite", label: "Send an invitation email" },
        { value: "password", label: "I set a temporary password" },
      ],
    },
    {
      name: "password",
      label: "Temporary password",
      type: "text",
      required: true,
      wide: true,
      showWhen: { field: "method", in: ["password"] },
      hint: "At least 8 characters. Ask them to change it from their profile.",
    },
  ];
}

/**
 * "Account access" on a member's profile: whether this member can sign in, and
 * the controls for it. Shown only to people who manage users.
 */
export async function AccountAccess({
  person,
  account,
  currentUserId,
  timezone,
  autoOpen = false,
}: {
  person: { id: string; full_name: string; email: string | null; archived_at: string | null };
  account: MemberAccount | null;
  currentUserId: string;
  timezone: string;
  /** Open the create dialog straight away (after "Add member" could not make the account). */
  autoOpen?: boolean;
}) {
  const supabase = await createClient();
  const { data: assignable } = await supabase.rpc("assignable_roles");
  const roles = ((assignable ?? []) as { id: string; key: string; name: string }[]).map((role) => ({ value: role.id, label: role.name }));
  const memberRole = ((assignable ?? []) as { id: string; key: string }[]).find((role) => role.key === "member")?.id ?? roles[0]?.value ?? "";

  if (!account) {
    return (
      <section className="rounded-xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="mb-1 text-base font-semibold">Account access</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {person.full_name} is in the church records but cannot sign in. Not every member needs an account.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill>No account</StatusPill>
          {person.archived_at ? (
            <span className="text-sm text-muted-foreground">Restore this member before creating an account.</span>
          ) : !isAdminConfigured ? (
            <span className="text-sm text-muted-foreground">
              Creating accounts needs <code>SUPABASE_SECRET_KEY</code> in the server environment.
            </span>
          ) : (
            <EntityDialog
              title={`Create account for ${person.full_name}`}
              description="The name and contact details come from the member record. The account is approved straight away."
              fields={accountFields(roles)}
              initial={{ email: person.email ?? "", role_id: memberRole, method: "invite", password: "" }}
              action={createMemberAccount.bind(null, person.id)}
              submitLabel="Create account"
              successMessage={`Account created for ${person.full_name}`}
              defaultOpen={autoOpen}
            >
              <UserPlus /> Create User Account
            </EntityDialog>
          )}
        </div>
      </section>
    );
  }

  const status = accountStatus(account);
  const approved = account.approval_status === "approved";
  const isSelf = account.user_id === currentUserId;
  const awaitingInvite = account.registration_source === "invited" && !account.last_sign_in_at;
  const assignableIds = new Set(roles.map((role) => role.value));

  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold">Account access</h2>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        {awaitingInvite && approved ? <StatusPill tone="warning">Invitation not accepted yet</StatusPill> : null}
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Login email">{account.email}</Detail>
        <Detail label="Role">{account.role_names.join(", ") || "No role"}</Detail>
        <Detail label="Last login">{account.last_sign_in_at ? formatDateTime(account.last_sign_in_at, timezone) : "Never"}</Detail>
        <Detail label="Account created">{formatDateTime(account.created_at, timezone)}</Detail>
        <Detail label="How it was created">{SOURCE[account.registration_source]}</Detail>
        <Detail label="Approved">
          {account.approved_at ? `${formatDateTime(account.approved_at, timezone)}${account.approved_by_name ? ` by ${account.approved_by_name}` : ""}` : null}
        </Detail>
      </dl>

      <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
        {!approved ? (
          <Link href="/admin/approvals" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <UserCheck /> Review in Account Approvals
          </Link>
        ) : (
          <>
            <EntityDialog
              title={`Roles for ${person.full_name}`}
              description="The role controls what the account can do. It is separate from church membership."
              fields={[{ name: "role_ids", label: "Roles", type: "multi", options: roles, hint: "A user gets the permissions of every role they hold." }]}
              initial={{ role_ids: account.role_ids.filter((id) => assignableIds.has(id)) }}
              action={saveAccountRoles.bind(null, account.user_id)}
              successMessage="Roles updated"
              variant="outline"
              size="sm"
            >
              <ShieldCheck /> Change Role
            </EntityDialog>
            {isAdminConfigured ? (
              <EntityDialog
                title="Change login email"
                description="This changes what they sign in with. The contact email on the member record stays as it is."
                fields={[{ name: "email", label: "New login email", type: "text", required: true, wide: true }]}
                initial={{ email: account.email }}
                action={changeLoginEmail.bind(null, account.user_id)}
                successMessage="Login email changed"
                variant="outline"
                size="sm"
              >
                <Mail /> Change Login Email
              </EntityDialog>
            ) : null}
            {awaitingInvite && isAdminConfigured ? (
              <ConfirmButton
                action={resendInvitation.bind(null, account.user_id)}
                title="Resend the invitation?"
                description={`${account.email} will receive a new link to choose a password.`}
                confirmLabel="Resend invitation"
                successMessage="Invitation sent"
                variant="outline"
                size="sm"
              >
                <MailPlus /> Resend Invitation
              </ConfirmButton>
            ) : (
              <ConfirmButton
                action={sendPasswordReset.bind(null, account.user_id)}
                title="Send a password reset email?"
                description={`${account.email} will receive a link to choose a new password.`}
                confirmLabel="Send email"
                successMessage="Reset email sent"
                variant="outline"
                size="sm"
              >
                <KeyRound /> Send Password Reset
              </ConfirmButton>
            )}
            {isSelf || (!account.is_active && person.archived_at) ? null : (
              <ConfirmButton
                action={setUserActive.bind(null, account.user_id, !account.is_active)}
                title={account.is_active ? "Suspend this account?" : "Reactivate this account?"}
                description={
                  account.is_active
                    ? `${person.full_name} will be signed out and unable to sign in. The member record, attendance and history are not affected.`
                    : `${person.full_name} will be able to sign in again with the same role.`
                }
                confirmLabel={account.is_active ? "Suspend account" : "Reactivate account"}
                successMessage={account.is_active ? "Account suspended" : "Account reactivated"}
                destructive={account.is_active}
                variant="outline"
                size="sm"
              >
                {account.is_active ? <UserX /> : <UserCheck />}
                {account.is_active ? "Suspend Account" : "Reactivate Account"}
              </ConfirmButton>
            )}
          </>
        )}
        <Link href={`/admin/users#user-${account.user_id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          View Account
        </Link>
      </div>
      {!account.is_active && person.archived_at ? (
        <p className="mt-3 text-xs text-muted-foreground">Restore this member to reactivate the account.</p>
      ) : null}
    </section>
  );
}
