"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldValues, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { KeyRound, Plus, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { createUser, sendPasswordReset, setUserActive, setUserRoles } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field, NativeSelect, PendingButton } from "@/components/shared/form";
import { PersonAvatar, StatusPill } from "@/components/shared/person-avatar";
import { newUserSchema } from "@/lib/validation";

export type UserRow = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  roleIds: string[];
  personName: string | null;
};
export type RoleOption = { id: string; key: string; name: string };

export function UserManager({
  users,
  roles,
  people,
  currentUserId,
  isSuperAdmin,
  adminReady,
}: {
  users: UserRow[];
  roles: RoleOption[];
  /** Members without a login yet, for linking. */
  people: { id: string; name: string }[];
  currentUserId: string;
  isSuperAdmin: boolean;
  adminReady: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // Only a Super Admin may hand out or take away the Super Admin role.
  const assignable = (role: RoleOption) => isSuperAdmin || role.key !== "super_admin";
  const roleName = (id: string) => roles.find((role) => role.id === id)?.name ?? "Unknown";

  const form = useForm<FieldValues>({
    resolver: zodResolver(newUserSchema) as unknown as Resolver<FieldValues>,
    defaultValues: { full_name: "", email: "", password: "", role_id: "", person_id: "" },
  });
  const error = (name: string) => form.formState.errors[name]?.message as string | undefined;

  const submitNew = form.handleSubmit(() => {
    const values = form.getValues();
    startTransition(async () => {
      const result = await createUser(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.message) toast.warning(result.message);
      else toast.success("User created. Share the email and temporary password with them.");
      form.reset();
      setCreating(false);
      router.refresh();
    });
  });

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
          {users.length} {users.length === 1 ? "user" : "users"}. There is no public sign-up; accounts are created here.
        </p>
        <Button onClick={() => setCreating(true)} disabled={!adminReady}>
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
          <li key={user.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <PersonAvatar name={user.full_name || user.email} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {user.full_name || user.email}
                  {user.id === currentUserId ? <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                  {user.personName ? ` · linked to ${user.personName}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {user.roleIds.length === 0 ? <StatusPill tone="warning">No role</StatusPill> : null}
              {user.roleIds.map((id) => (
                <StatusPill key={id} tone="brand">
                  {roleName(id)}
                </StatusPill>
              ))}
              {user.is_active ? null : <StatusPill tone="danger">Deactivated</StatusPill>}
            </div>
            <div className="flex items-center gap-1 sm:ml-2">
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
              {user.id !== currentUserId ? (
                <ConfirmButton
                  action={setUserActive.bind(null, user.id, !user.is_active)}
                  title={user.is_active ? "Deactivate this user?" : "Reactivate this user?"}
                  description={
                    user.is_active
                      ? `${user.email} will be signed out and lose all access until reactivated. Their records are kept.`
                      : `${user.email} will be able to sign in again with their existing roles.`
                  }
                  confirmLabel={user.is_active ? "Deactivate" : "Reactivate"}
                  successMessage={user.is_active ? "User deactivated" : "User reactivated"}
                  destructive={user.is_active}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${user.is_active ? "Deactivate" : "Reactivate"} ${user.email}`}
                >
                  {user.is_active ? <UserX /> : <UserCheck />}
                </ConfirmButton>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={creating} onOpenChange={(next) => !pending && setCreating(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>They can sign in right away with this email and temporary password, and change it from their profile.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitNew} className="space-y-4" noValidate>
            <Field label="Full name" htmlFor="full_name" required error={error("full_name")}>
              <Input id="full_name" {...form.register("full_name")} />
            </Field>
            <Field label="Email" htmlFor="new_email" required error={error("email")}>
              <Input id="new_email" type="email" autoComplete="off" {...form.register("email")} />
            </Field>
            <Field label="Temporary password" htmlFor="new_password" required error={error("password")} hint="At least 8 characters.">
              <Input id="new_password" type="text" autoComplete="off" {...form.register("password")} />
            </Field>
            <Field label="Role" htmlFor="role_id" required error={error("role_id")}>
              <NativeSelect id="role_id" {...form.register("role_id")}>
                <option value="">Choose a role…</option>
                {roles.filter(assignable).map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Link to member record"
              htmlFor="person_id"
              error={error("person_id")}
              hint="Needed for Cell Leaders (to know their groups) and for the member portal."
            >
              <NativeSelect id="person_id" {...form.register("person_id")}>
                <option value="">Not linked</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)} disabled={pending}>
                Cancel
              </Button>
              <PendingButton type="submit" pending={pending} pendingText="Creating…">
                Create user
              </PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(next) => !next && !pending && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Roles for {editing?.full_name || editing?.email}</DialogTitle>
            <DialogDescription>A user gets the permissions of every role they hold.</DialogDescription>
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
                    {!assignable(role) ? <span className="text-xs text-muted-foreground">Super Admin only</span> : null}
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
