"use client";

import { useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { startNavigationProgress } from "@/components/app/navigation-progress";
import { Field, NativeSelect, PendingButton } from "@/components/shared/form";
import { createClient } from "@/lib/supabase/client";
import type { ActionResult } from "@/lib/types";

export type FieldOption = { value: string; label: string };

export type FieldDef = {
  name: string;
  label: string;
  type: "text" | "textarea" | "date" | "time" | "number" | "select" | "switch" | "multi" | "file";
  required?: boolean;
  options?: FieldOption[];
  /** Label of the empty choice in a select. Omit to force a choice. */
  emptyLabel?: string;
  hint?: string;
  placeholder?: string;
  /** Take the full width of the two-column grid. */
  wide?: boolean;
  /** Only show this field while another field has one of these values. */
  showWhen?: { field: string; in: string[] };
  /** Required only while another field has one of these values. */
  requiredWhen?: { field: string; in: string[] };
  /** For selects: the choices depend on another field's value. */
  optionsBy?: { field: string; map: Record<string, FieldOption[]> };
  /** For files: the private Storage bucket to upload to, and what is accepted. */
  upload?: { bucket: string; accept: string[]; maxBytes: number };
};

export type FormValues = Record<string, string | boolean | string[]>;

/**
 * A create/edit dialog described by a list of fields. Used by every module
 * that edits a record in place (cell groups, follow-ups, events, giving, ...).
 * Required fields are checked here; the Server Action validates everything
 * again with Zod and the database enforces permissions.
 */
export function EntityDialog({
  title,
  description,
  fields,
  initial,
  action,
  submitLabel = "Save",
  successMessage = "Saved",
  redirectOnCreate,
  defaultOpen = false,
  children,
  ...buttonProps
}: {
  title: string;
  description?: string;
  fields: FieldDef[];
  initial: FormValues;
  action: (values: FormValues) => Promise<ActionResult<{ id?: string } | undefined>>;
  submitLabel?: string;
  successMessage?: string;
  /** After a successful save, go to this path with the new id appended. */
  redirectOnCreate?: string;
  /** Start open (used by the command palette's quick actions via ?new=1). */
  defaultOpen?: boolean;
  children: ReactNode;
} & Omit<ComponentProps<typeof Button>, "onClick" | "children">) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(defaultOpen);
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const visible = fields.filter(
    (field) => !field.showWhen || field.showWhen.in.includes(String(values[field.showWhen.field] ?? "")),
  );
  // Files wait here and are uploaded on Save, so a cancelled form leaves nothing behind.
  const [files, setFiles] = useState<Record<string, File>>({});

  const optionsOf = (field: FieldDef, from: FormValues) =>
    field.optionsBy ? (field.optionsBy.map[String(from[field.optionsBy.field] ?? "")] ?? []) : (field.options ?? []);
  const isRequired = (field: FieldDef) =>
    Boolean(field.required) || Boolean(field.requiredWhen?.in.includes(String(values[field.requiredWhen.field] ?? "")));

  const set = (name: string, value: string | boolean | string[]) => {
    setValues((current) => {
      const next = { ...current, [name]: value };
      // Selects whose choices depend on this field: keep a still-valid choice,
      // pick the only one automatically, otherwise clear it.
      for (const field of fields) {
        if (field.optionsBy?.field !== name) continue;
        const choices = optionsOf(field, next);
        if (!choices.some((choice) => choice.value === next[field.name])) {
          next[field.name] = choices.length === 1 ? choices[0].value : "";
        }
      }
      return next;
    });
    setErrors((current) => ({ ...current, [name]: "" }));
  };

  function close() {
    setOpen(false);
    // Drop ?new=1 so a refresh doesn't reopen the dialog.
    if (defaultOpen && window.location.search.includes("new=1")) {
      window.history.replaceState(null, "", pathname);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    for (const field of visible) {
      const value = values[field.name];
      const empty = value === "" || value === undefined || (field.type === "file" && !value && !files[field.name]);
      if (isRequired(field) && empty && !(field.type === "file" && files[field.name])) {
        found[field.name] = `${field.label} is required`;
      }
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    startTransition(async () => {
      const payload = { ...values };
      // Hidden fields must not carry a value from a previous choice.
      for (const field of fields) {
        if (!visible.includes(field) && field.type !== "switch") payload[field.name] = field.type === "multi" ? [] : "";
      }
      for (const field of visible) {
        const file = files[field.name];
        if (field.type !== "file" || !file || !field.upload) continue;
        const extension = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `${crypto.randomUUID()}.${extension}`;
        const { error } = await createClient().storage.from(field.upload.bucket).upload(path, file, { contentType: file.type });
        if (error) {
          toast.error("The file could not be uploaded. Nothing was saved.");
          return;
        }
        payload[field.name] = path;
      }
      const result = await action(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      setFiles({});
      close();
      if (redirectOnCreate && result.data?.id) {
        startNavigationProgress();
        router.push(`${redirectOnCreate}/${result.data.id}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button
        {...buttonProps}
        onClick={() => {
          setValues(initial);
          setFiles({});
          setErrors({});
          setOpen(true);
        }}
      >
        {children}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && (next ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <form onSubmit={submit} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              {visible.map((field) => {
                const id = `field-${field.name}`;
                const value = values[field.name];
                const className = field.wide || field.type === "textarea" || field.type === "multi" ? "sm:col-span-2" : undefined;

                if (field.type === "switch") {
                  return (
                    <label key={field.name} className={`flex items-start gap-3 text-sm ${className ?? ""}`}>
                      <Switch checked={Boolean(value)} onCheckedChange={(checked) => set(field.name, checked)} />
                      <span>
                        {field.label}
                        {field.hint ? <span className="block text-xs text-muted-foreground">{field.hint}</span> : null}
                      </span>
                    </label>
                  );
                }

                return (
                  <Field
                    key={field.name}
                    label={field.label}
                    htmlFor={id}
                    required={isRequired(field)}
                    hint={field.hint}
                    error={errors[field.name] || undefined}
                    className={className}
                  >
                    {field.type === "select" ? (
                      <NativeSelect id={id} value={String(value ?? "")} onChange={(e) => set(field.name, e.target.value)}>
                        {field.emptyLabel !== undefined ? <option value="">{field.emptyLabel}</option> : null}
                        {optionsOf(field, values).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : field.type === "file" ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <label className={`${buttonVariants({ variant: "outline", size: "sm" })} cursor-pointer`}>
                          <Paperclip /> {files[field.name] || value ? "Replace file" : "Choose file"}
                          <input
                            id={id}
                            type="file"
                            accept={field.upload?.accept.join(",")}
                            className="sr-only"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (!file || !field.upload) return;
                              if (!field.upload.accept.includes(file.type)) {
                                toast.error("That file type isn't accepted here.");
                                return;
                              }
                              if (file.size > field.upload.maxBytes) {
                                toast.error(`That file is larger than ${Math.round(field.upload.maxBytes / 1048576)} MB.`);
                                return;
                              }
                              setFiles((current) => ({ ...current, [field.name]: file }));
                              setErrors((current) => ({ ...current, [field.name]: "" }));
                            }}
                          />
                        </label>
                        <span className="min-w-0 truncate text-muted-foreground">
                          {files[field.name]?.name ?? (value ? "A file is attached" : "No file")}
                        </span>
                        {files[field.name] || value ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setFiles((current) => {
                                const next = { ...current };
                                delete next[field.name];
                                return next;
                              });
                              set(field.name, "");
                            }}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    ) : field.type === "textarea" ? (
                      <Textarea id={id} rows={3} value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => set(field.name, e.target.value)} />
                    ) : field.type === "multi" ? (
                      <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                        {(field.options ?? []).length === 0 ? (
                          <li className="text-xs text-muted-foreground">No one to choose from.</li>
                        ) : null}
                        {field.options?.map((option) => {
                          const selected = Array.isArray(value) ? value : [];
                          return (
                            <li key={option.value}>
                              <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={selected.includes(option.value)}
                                  onCheckedChange={(checked) =>
                                    set(field.name, checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))
                                  }
                                />
                                {option.label}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <Input
                        id={id}
                        type={field.type}
                        step={field.type === "number" ? "0.01" : undefined}
                        min={field.type === "number" ? "0" : undefined}
                        inputMode={field.type === "number" ? "decimal" : undefined}
                        value={String(value ?? "")}
                        placeholder={field.placeholder}
                        aria-invalid={Boolean(errors[field.name])}
                        onChange={(e) => set(field.name, e.target.value)}
                      />
                    )}
                  </Field>
                );
              })}
            </div>
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <PendingButton type="submit" pending={pending} pendingText="Saving…">
                {submitLabel}
              </PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
