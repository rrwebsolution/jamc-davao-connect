"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { saveLabels } from "@/app/(app)/admin/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { FormSection, PendingButton } from "@/components/shared/form";
import { LABEL_GROUPS, LABEL_MAX_LENGTH, type LabelEntry, type UiLabels } from "@/lib/labels";

function LabelRow({ entry, value, onChange }: { entry: LabelEntry; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const Control = entry.kind === "description" ? Textarea : Input;
  const renamed = value.trim() !== "" && value.trim() !== entry.text;

  return (
    <div className="grid grid-cols-1 gap-1.5 border-b py-3 last:border-b-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-start sm:gap-3">
      <label htmlFor={id} className="min-w-0 pt-1.5 text-sm">
        <span className={renamed ? "text-muted-foreground line-through" : undefined}>{entry.text}</span>
        {entry.hint ? <span className="block text-xs text-muted-foreground">{entry.hint}</span> : null}
      </label>
      <Control
        id={id}
        rows={entry.kind === "description" ? 2 : undefined}
        maxLength={LABEL_MAX_LENGTH[entry.kind]}
        placeholder={entry.text}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="justify-self-end"
        disabled={!value}
        onClick={() => onChange("")}
        aria-label={`Use the original text for ${entry.text}`}
        title="Use the original text"
      >
        <RotateCcw />
      </Button>
    </div>
  );
}

/**
 * Settings → Labels: rename menu items, page titles and page descriptions.
 * An empty field keeps the original text, which is shown as the placeholder.
 */
export function LabelsForm({ labels }: { labels: UiLabels }) {
  const [values, setValues] = useState<UiLabels>(labels);
  const [saved, setSaved] = useState<UiLabels>(labels);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  /** The card being saved, for its button's spinner. */
  const [savingGroup, setSavingGroup] = useState<string | null>(null);

  const isDirty = (title: string) =>
    LABEL_GROUPS.find((group) => group.title === title)?.entries.some(
      (entry) => (values[entry.text] ?? "").trim() !== (saved[entry.text] ?? "").trim(),
    ) ?? false;
  const renamedCount = Object.values(saved).filter(Boolean).length;

  const term = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      LABEL_GROUPS.map((group) => ({
        ...group,
        entries: term
          ? group.entries.filter((entry) =>
              [entry.text, entry.hint ?? "", values[entry.text] ?? ""].some((text) => text.toLowerCase().includes(term)),
            )
          : group.entries,
      })).filter((group) => group.entries.length > 0),
    [term, values],
  );

  /** Saves one card: its fields as edited, the other cards as last saved (their unsaved edits stay on screen). */
  function save(title: string) {
    const group = LABEL_GROUPS.find((entry) => entry.title === title);
    if (!group) return;
    const next = { ...saved };
    for (const entry of group.entries) {
      const value = (values[entry.text] ?? "").trim();
      if (value) next[entry.text] = value;
      else delete next[entry.text];
    }
    setSavingGroup(title);
    startTransition(async () => {
      const result = await saveLabels(next);
      setSavingGroup(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved(next);
      toast.success(`${group.title} saved`);
    });
  }

  return (
    <div className="space-y-4">
      <FormSection
        title="Labels"
        description="Rename the menu, page titles and page descriptions to match how your church speaks. Leave a field empty to keep the original text. Changes show for everyone after saving."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a label…"
              aria-label="Find a label"
              className="pl-8"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {renamedCount === 0 ? "Nothing renamed yet." : `${renamedCount} renamed.`}
          </p>
        </div>
      </FormSection>

      {groups.map((group) => (
        <form
          key={group.title}
          onSubmit={(event) => {
            event.preventDefault();
            save(group.title);
          }}
          noValidate
        >
          <FormSection title={group.title} description={group.description}>
            <div>
              {group.entries.map((entry) => (
                <LabelRow
                  key={entry.text}
                  entry={entry}
                  value={values[entry.text] ?? ""}
                  onChange={(value) => setValues((current) => ({ ...current, [entry.text]: value }))}
                />
              ))}
            </div>
            <div className="mt-4 flex justify-end border-t pt-4">
              <PendingButton
                type="submit"
                pending={savingGroup === group.title}
                pendingText="Saving…"
                disabled={pending || !isDirty(group.title)}
                className="w-full sm:w-auto"
              >
                Save labels
              </PendingButton>
            </div>
          </FormSection>
        </form>
      ))}
      {groups.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No label matches “{query.trim()}”.</p> : null}

      <div className="flex justify-end">
        <ConfirmButton
          action={async () => {
            const result = await saveLabels({});
            if (result.ok) {
              setValues({});
              setSaved({});
            }
            return result;
          }}
          title="Reset all labels?"
          description="Every menu item, page title and description goes back to its original text. This takes effect immediately."
          confirmLabel="Reset"
          successMessage="Labels reset to the original text"
          destructive
          variant="ghost"
          size="sm"
          disabled={pending || renamedCount === 0}
        >
          <RotateCcw /> Reset all labels
        </ConfirmButton>
      </div>
    </div>
  );
}
