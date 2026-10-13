"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { moveLookup, removeLookup, saveLookup, setDefaultLookup } from "@/app/(app)/admin/settings/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field, FormSection, PendingButton } from "@/components/shared/form";
import { StatusPill } from "@/components/shared/person-avatar";
import type { ActionResult, Lookup } from "@/lib/types";

type Draft = { id: string | null; name: string; description: string; is_active: boolean; flag: boolean };

/**
 * Add, rename, reorder, switch off and remove the items of one configurable
 * list (membership statuses, attendance types, discipleship stages, ...).
 */
export function LookupManager({
  table,
  title,
  description,
  noun,
  items,
  flag,
  hasDefault = false,
  hasDescription = false,
  removeVerb = "Delete",
}: {
  table: string;
  title: string;
  description: string;
  noun: string;
  items: Lookup[];
  /** An extra on/off property, e.g. "Counts as present". */
  flag?: { key: "counts_for_absence" | "counts_as_present"; label: string; hint: string };
  hasDefault?: boolean;
  hasDescription?: boolean;
  removeVerb?: "Delete" | "Archive";
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, success?: string, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (success) toast.success(success);
      after?.();
      router.refresh();
    });
  }

  function submitDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.name.trim()) {
      setNameError("Name is required");
      return;
    }
    run(
      () => saveLookup(table, draft.id, { name: draft.name, description: draft.description, is_active: draft.is_active, flag: draft.flag }),
      draft.id ? "Changes saved" : `${noun} added`,
      () => setDraft(null),
    );
  }

  const open = (item?: Lookup) => {
    setNameError(null);
    setDraft({
      id: item?.id ?? null,
      name: item?.name ?? "",
      description: item?.description ?? "",
      is_active: item?.is_active ?? true,
      flag: flag ? Boolean(item?.[flag.key]) : false,
    });
  };

  return (
    <FormSection title={title} description={description}>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((item, index) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 p-2.5 sm:flex-nowrap">
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm font-medium">{item.name}</p>
                {item.description ? <p className="truncate text-xs text-muted-foreground">{item.description}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {hasDefault && item.is_default ? <StatusPill tone="brand">Default</StatusPill> : null}
                {flag && item[flag.key] ? <StatusPill tone="success">{flag.label}</StatusPill> : null}
                {!item.is_active ? <StatusPill>Off</StatusPill> : null}
              </div>
              <div className="ml-auto flex items-center">
                {hasDefault && !item.is_default && item.is_active ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={pending}
                    onClick={() => run(() => setDefaultLookup(table, item.id), `${item.name} is now the default`)}
                    aria-label={`Make ${item.name} the default`}
                    title="Make default"
                  >
                    <Star />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending || index === 0}
                  onClick={() => run(() => moveLookup(table, item.id, "up"))}
                  aria-label={`Move ${item.name} up`}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending || index === items.length - 1}
                  onClick={() => run(() => moveLookup(table, item.id, "down"))}
                  aria-label={`Move ${item.name} down`}
                >
                  <ArrowDown />
                </Button>
                <Button variant="ghost" size="icon-sm" disabled={pending} onClick={() => open(item)} aria-label={`Edit ${item.name}`}>
                  <Pencil />
                </Button>
                <ConfirmButton
                  action={removeLookup.bind(null, table, item.id)}
                  title={`${removeVerb} “${item.name}”?`}
                  description={
                    removeVerb === "Archive"
                      ? "It will no longer be offered for new assignments. Existing history is kept."
                      : "This can't be undone. If it is already in use it can't be deleted; switch it off instead."
                  }
                  confirmLabel={removeVerb}
                  successMessage={`${noun} ${removeVerb === "Archive" ? "archived" : "deleted"}`}
                  destructive
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${removeVerb} ${item.name}`}
                >
                  <Trash2 />
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" className="mt-3" onClick={() => open()}>
        <Plus /> Add {noun.toLowerCase()}
      </Button>

      <Dialog open={draft !== null} onOpenChange={(next) => !next && !pending && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? `Edit ${noun.toLowerCase()}` : `Add ${noun.toLowerCase()}`}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {draft ? (
            <form onSubmit={submitDraft} className="space-y-4" noValidate>
              <Field label="Name" htmlFor={`${table}-name`} required error={nameError ?? undefined}>
                <Input
                  id={`${table}-name`}
                  autoFocus
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) => {
                    setNameError(null);
                    setDraft({ ...draft, name: event.target.value });
                  }}
                />
              </Field>
              {hasDescription ? (
                <Field label="Description" htmlFor={`${table}-description`}>
                  <Textarea
                    id={`${table}-description`}
                    rows={2}
                    maxLength={300}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </Field>
              ) : null}
              {flag ? (
                <label className="flex items-start gap-3 text-sm">
                  <Switch checked={draft.flag} onCheckedChange={(checked) => setDraft({ ...draft, flag: checked })} />
                  <span>
                    {flag.label}
                    <span className="block text-xs text-muted-foreground">{flag.hint}</span>
                  </span>
                </label>
              ) : null}
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={draft.is_active} onCheckedChange={(checked) => setDraft({ ...draft, is_active: checked })} />
                <span>
                  Active
                  <span className="block text-xs text-muted-foreground">Switched-off items stay on old records but aren&apos;t offered for new ones.</span>
                </span>
              </label>
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
    </FormSection>
  );
}
