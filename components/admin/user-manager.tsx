"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Link2, Plus, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { createMemberAccount, linkAccountToMember, sendPasswordReset, setUserActive, setUserRoles } from "@/app/(app)/admin/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/shared/password-input";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog } from "@/components/shared/entity-dialog";
import { Field, NativeSelect, PendingButton } from "@/components/shared/form";
import { PersonAvatar, StatusPill } from "@/components/shared/person-avatar";

export type UserRow = {
  id: string;
  email: string;
  /** The linked member's name, or the account's own name when it has no member. */
  name: string;
  is_active: boolean;
  approval_status: "pending" | "approved" | "rejected";
  account_status: "pending" | "active" | "suspended" | "disabled";
  roleIds: string[];
  personId: string | null;
  personName: string | null;
  memberCode: string | null;
  lastLogin: string | null;
};
export type RoleOption = { id: string; key: string; name: string };
/** A member the admin may pick when creating an account. */
export type MemberOption = { id: string; name: string; detail: string; email: string | null; userId: string | null };

const emptyAccount = { person_id: "", email: "", method: "invite", password: "", role_id: "" };

export function UserManager({
  users,
  roles,
  members,
  currentUserId,
  assignableRoleIds,
  adminReady,
}: {
  users: UserRow[];
  roles: RoleOption[];
  /** Current members, with or without a login. */
  members: MemberOption[];
  currentUserId: string;
  /** Roles this admin is allowed to assign. */
  assignableRoleIds: string[];
  adminReady: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // Which roles may be handed out is decided by the database; this mirrors it.
  const assignable = (role: RoleOption) => assignableRoleIds.includes(role.id);
  const roleName = (id: string) => roles.find((role) => role.id === id)?.name ?? "Unknown";
  const defaultRole = roles.find((role) => role.key === "member" && assignable(role))?.id ?? "";

  const [account, setAccount] = useState(emptyAccount);
  const [formError, setFormError] = useState<string | null>(null);
  const member = members.find((option) => option.id === account.person_id) ?? null;
  const existing = member?.userId ? (users.find((user) => user.id === member.userId) ?? null) : null;
  const unlinked = members.filter((option) => !option.userId);

  function openCreate() {
    setAccount({ ...emptyAccount, role_id: defaultRole });
    setFormError(null);
    setCreating(true);
  }

  function chooseMember(id: string) {
    const chosen = members.find((option) => option.id === id);
    // The login email starts as the member's contact email; the admin may change it.
    setAccount((current) => ({ ...current, person_id: id, email: chosen?.email ?? "" }));
    setFormError(null);
  }

  function submitNew(event: React.FormEvent) {
    event.preventDefault();
    if (!member || member.userId) return;
    const problem = !/^\S+@\S+\.\S+$/.test(account.email.trim())
      ? "Enter a valid login email."
      : !account.role_id
        ? "Choose a role."
        : account.method === "password" && account.password.length < 8
          ? "The temporary password needs at least 8 characters."
          : null;
    setFormError(problem);
    if (problem) return;

    startTransition(async () => {
      const result = await createMemberAccount(member.id, account);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      toast.success(
        account.method === "invite"
          ? `Invitation sent to ${member.name}. The account is ready once they set a password.`
          : `Account created for ${member.name}. Share the login email and temporary password with them.`,
      );
      setCreating(false);
      router.refresh();
    });
  }

  function saveRoles() {
    if (!editing) return;
    startTransition(async () => {
      const result = await setUserRoles(editing.id, selected);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Roles updated");
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {users.length} {users.length === 1 ? "account" : "accounts"}. An account is the login of a member; the member record holds the person&apos;s details.
        </p>
        <Button onClick={openCreate} disabled={!adminReady}>
          <Plus /> Add user
        </Button>
      </div>
      {!adminReady ? (
        <p className="mb-4 rounded-lg bg-warning/15 p-3 text-sm">
          Adding users needs <code>SUPABASE_SECRET_KEY</code> in the server environment. Roles and status can still be changed.
        </p>
      ) : null}

      <ul className="divide-y rounded-xl border bg-card">
        {users.map((user) => (
          <li key={user.id} id={`user-${user.id}`} className="flex scroll-mt-24 flex-col gap-3 p-3 target:bg-accent/60 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <PersonAvatar name={user.name || user.email} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {user.name || user.email}
                  {user.id === currentUserId ? <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.personId ? (
                    <>
                      Linked member:{" "}
                      <Link href={`/people/members/${user.personId}`} className="font-medium text-link hover:underline">
                        {user.personName}
                        {user.memberCode ? ` · ${user.memberCode}` : ""}
                      </Link>
                    </>
                  ) : (
                    "Not linked to a member"
                  )}
                  {user.approval_status === "approved" ? ` · Last login: ${user.lastLogin ?? "never"}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {user.roleIds.length === 0 && user.approval_status === "approved" ? <StatusPill tone="warning">No role</StatusPill> : null}
              {user.roleIds.map((id) => (
                <StatusPill key={id} tone="brand">
                  {roleName(id)}
                </StatusPill>
              ))}
              {user.approval_status === "pending" ? (
                <StatusPill tone="warning">Pending approval</StatusPill>
              ) : user.approval_status === "rejected" ? (
                <StatusPill tone="danger">Not approved</StatusPill>
              ) : user.is_active ? null : (
                <StatusPill tone="danger">{user.account_status === "disabled" ? "Disabled" : "Suspended"}</StatusPill>
              )}
            </div>
            <div className="flex items-center gap-1 sm:ml-2">
              {user.personId || user.approval_status !== "approved" ? null : (
                <EntityDialog
                  title={`Link ${user.name || user.email} to a member`}
                  description="An account is the login of a member. Choose the member record this account belongs to."
                  fields={[
                    {
                      name: "person_id",
                      label: "Member",
                      type: "select",
                      required: true,
                      wide: true,
                      emptyLabel: "Search members…",
                      options: unlinked.map((option) => ({ value: option.id, label: `${option.name} · ${option.detail}` })),
                      hint: "Only members without an account are listed. Check it is the same person.",
                    },
                  ]}
                  initial={{ person_id: "" }}
                  action={linkAccountToMember.bind(null, user.id)}
                  submitLabel="Link member"
                  successMessage="Account linked to the member"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Link ${user.email} to a member`}
                >
                  <Link2 />
                </EntityDialog>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setSelected(user.roleIds);
                  setEditing(user);
                }}
                aria-label={`Change roles for ${user.email}`}
                title="Change roles"
              >
                <ShieldCheck />
              </Button>
              <ConfirmButton
                action={sendPasswordReset.bind(null, user.id)}
                title="Send a password reset email?"
                description={`${user.email} will receive a link to choose a new password.`}
                confirmLabel="Send email"
                successMessage="Reset email sent"
                variant="ghost"
                size="icon-sm"
                aria-label={`Send password reset to ${user.email}`}
              >
                <KeyRound />
              </ConfirmButton>
              {user.id !== currentUserId && user.approval_status === "approved" ? (
                <ConfirmButton
                  action={setUserActive.bind(null, user.id, !user.is_active)}
                  title={user.is_active ? "Suspend this account?" : "Reactivate this account?"}
                  description={
                    user.is_active
                      ? `${user.email} will be signed out and lose all access until reactivated. The member record and its history are kept.`
                      : `${user.email} will be able to sign in again with their existing roles.`
                  }
                  confirmLabel={user.is_active ? "Suspend" : "Reactivate"}
                  successMessage={user.is_active ? "Account suspended" : "Account reactivated"}
                  destructive={user.is_active}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${user.is_active ? "Suspend" : "Reactivate"} ${user.email}`}
                >
                  {user.is_active ? <UserX /> : <UserCheck />}
                </ConfirmButton>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={creating} onOpenChange={(next) => !pending && setCreating(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              Choose the member who needs to sign in. Their name and details come from the member record, and the account is approved straight away.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitNew} className="space-y-4" noValidate>
            <Field
              label="Member"
              htmlFor="account_member"
              required
              hint={members.length === 0 ? "No members to choose from. Add the person under People → Members first." : undefined}
            >
              <NativeSelect id="account_member" value={account.person_id} onChange={(event) => chooseMember(event.target.value)}>
                <option value="">Search members…</option>
                {members.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} · {option.detail}
                    {option.userId ? " · has an account" : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            {!member ? (
              <p className="text-sm text-muted-foreground">
                Not in the list?{" "}
                <Link href="/people/members/new" className="font-medium text-link hover:underline">
                  Add the member first
                </Link>
                ; you can create their account in the same form.
              </p>
            ) : member.userId ? (
              <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                <p className="font-medium">{member.name} already has a system account.</p>
                {existing ? (
                  <dl className="mt-2 space-y-1 text-muted-foreground">
                    <div>
                      Status:{" "}
                      {existing.approval_status === "pending"
                        ? "Pending approval"
                        : existing.approval_status === "rejected"
                          ? "Not approved"
                          : existing.is_active
                            ? "Active"
                            : "Suspended"}
                    </div>
                    <div>Role: {existing.roleIds.map(roleName).join(", ") || "No role"}</div>
                    <div>Login email: {existing.email}</div>
                  </dl>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={`#user-${member.userId}`} onClick={() => setCreating(false)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    View Account
                  </a>
                  <Link href={`/people/members/${member.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    View Member Profile
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <Field
                  label="Login email"
                  htmlFor="account_email"
                  required
                  hint={member.email ? "Taken from the member record. Change it if they sign in with a different email." : "This member has no email on record."}
                >
                  <Input
                    id="account_email"
                    type="email"
                    autoComplete="off"
                    value={account.email}
                    onChange={(event) => setAccount((current) => ({ ...current, email: event.target.value }))}
                  />
                </Field>
                <Field label="Role" htmlFor="account_role" required>
                  <NativeSelect id="account_role" value={account.role_id} onChange={(event) => setAccount((current) => ({ ...current, role_id: event.target.value }))}>
                    <option value="">Choose a role…</option>
                    {roles.filter(assignable).map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field
                  label="How they get their password"
                  htmlFor="account_method"
                  hint={account.method === "invite" ? "They receive an email with a link to choose their own password. Needs email sending to be set up in Supabase." : undefined}
                >
                  <NativeSelect id="account_method" value={account.method} onChange={(event) => setAccount((current) => ({ ...current, method: event.target.value }))}>
                    <option value="invite">Send an invitation email</option>
                    <option value="password">I set a temporary password</option>
                  </NativeSelect>
                </Field>
                {account.method === "password" ? (
                  <Field label="Temporary password" htmlFor="account_password" required hint="At least 8 characters. Ask them to change it from their profile.">
                    <PasswordInput
                      id="account_password"
                      value={account.password}
                      onChange={(password) => setAccount((current) => ({ ...current, password }))}
                    />
                  </Field>
                ) : null}
              </>
            )}

            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)} disabled={pending}>
                Cancel
              </Button>
              <PendingButton type="submit" pending={pending} pendingText="Creating…" disabled={!member || Boolean(member.userId)}>
                {account.method === "invite" ? "Send Invitation" : "Create Account"}
              </PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(next) => !next && !pending && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Roles for {editing?.name || editing?.email}</DialogTitle>
            <DialogDescription>A user gets the permissions of every role they hold. Roles are separate from church membership.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {roles.map((role) => {
              const checked = selected.includes(role.id);
              return (
                <li key={role.id}>
                  <label className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
                    <Checkbox
                      checked={checked}
                      disabled={!assignable(role)}
                      onCheckedChange={(next) =>
                        setSelected((current) => (next ? [...current, role.id] : current.filter((id) => id !== role.id)))
                      }
                    />
                    <span className="flex-1">{role.name}</span>
                    {!assignable(role) ? <span className="text-xs text-muted-foreground">Not yours to assign</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <PendingButton pending={pending} pendingText="Saving…" onClick={saveRoles}>
              Save roles
            </PendingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
