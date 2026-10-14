"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "cn";
import { deleteRole, saveRole, setRolePermission } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field, PendingButton } from "@/components/shared/form";

export type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  userCount: number;
  permissionIds: string[];
};
export type PermissionRow = { id: string; key: string; module: string; description: string };

type Draft = { id: string | null; name: string; description: string };

/** Pick a role on the left, switch its permissions on and off on the right. */
export function RoleManager({ roles, permissions }: { roles: RoleRow[]; permissions: PermissionRow[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();
  const role = roles.find((item) => item.id === selectedId) ?? roles[0];

  // Flip the switch immediately; the server result replaces it on refresh.
  const [granted, setGranted] = useOptimistic(
    role?.permissionIds ?? [],
    (current: string[], change: { id: string; on: boolean }) =>
      change.on ? [...current, change.id] : current.filter((id) => id !== change.id),
  );

  const modules = [...new Set(permissions.map((permission) => permission.module))];
  const locked = role?.key === "super_admin";

  function toggle(permission: PermissionRow, on: boolean) {
    if (!role) return;
    startTransition(async () => {
      setGranted({ id: permission.id, on });
      const result = await setRolePermission(role.id, permission.id, on);
      if (!result.ok) {
        toast.error(result.error);
      }
      router.refresh();
    });
  }

  function submitDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !draft.name.trim()) return;
    startTransition(async () => {
      const result = await saveRole(draft.id, { name: draft.name, description: draft.description });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(draft.id ? "Role updated" : "Role created");
      setDraft(null);
      router.refresh();
    });
  }

  if (!role) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div>
        <ul className="space-y-2">
          {roles.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                aria-pressed={item.id === role.id}
                className={cn(
                  "w-full rounded-xl border bg-card p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  item.id === role.id ? "border-primary ring-1 ring-primary" : "hover:border-ring",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{item.name}</span>
                  {item.is_system ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="System role" /> : null}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {item.userCount} {item.userCount === 1 ? "user" : "users"} · {item.key === "super_admin" ? "all" : item.permissionIds.length} permissions
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="outline" className="mt-3 w-full" onClick={() => setDraft({ id: null, name: "", description: "" })}>
          <Plus /> New role
        </Button>
      </div>

      <section className="rounded-xl border bg-card p-4 shadow-xs sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{role.name}</h2>
            <p className="text-sm text-muted-foreground">{role.description || "No description."}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft({ id: role.id, name: role.name, description: role.description ?? "" })}
            >
              <Pencil /> Rename
            </Button>
            {!role.is_system ? (
              <ConfirmButton
                action={deleteRole.bind(null, role.id)}
                title={`Delete the “${role.name}” role?`}
                description={`${role.userCount} ${role.userCount === 1 ? "user loses" : "users lose"} the permissions this role gives them. This can't be undone.`}
                confirmLabel="Delete role"
                successMessage="Role deleted"
                destructive
                variant="outline"
                size="sm"
              >
                <Trash2 /> Delete
              </ConfirmButton>
            ) : null}
          </div>
        </div>

        {locked ? (
          <p className="mb-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            Super Admin always has every permission, including ones added later. It can&apos;t be reduced.
          </p>
        ) : null}

        <div className="space-y-5">
          {modules.map((module) => (
            <fieldset key={module}>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{module}</legend>
              <ul className="divide-y rounded-lg border">
                {permissions
                  .filter((permission) => permission.module === module)
                  .map((permission) => (
                    <li key={permission.id}>
                      <label className="flex items-center gap-3 p-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">{permission.description}</span>
                          <span className="block font-mono text-xs text-muted-foreground">{permission.key}</span>
                        </span>
                        <Switch
                          checked={locked || granted.includes(permission.id)}
                          disabled={locked || pending}
                          onCheckedChange={(on) => toggle(permission, on)}
                          aria-label={`${permission.description} for ${role.name}`}
                        />
                      </label>
                    </li>
                  ))}
              </ul>
            </fieldset>
          ))}
        </div>
      </section>

      <Dialog open={draft !== null} onOpenChange={(next) => !next && !pending && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Rename role" : "New role"}</DialogTitle>
            <DialogDescription>
              {draft?.id ? "Changing the name doesn't change what the role can do." : "New roles start with no permissions. Switch them on after creating the role."}
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <form onSubmit={submitDraft} className="space-y-4">
              <Field label="Name" htmlFor="role-name" required>
                <Input id="role-name" autoFocus required maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Description" htmlFor="role-description">
                <Textarea id="role-description" rows={2} maxLength={200} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={pending}>
                  Cancel
                </Button>
                <PendingButton type="submit" pending={pending} pendingText="Saving…">
                  Save
                </PendingButton>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
