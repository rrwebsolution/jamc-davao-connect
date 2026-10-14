"use client";

import { useMemo, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip, Plus, Trash2, TriangleAlert } from "lucide-react";
import { findDuplicateReferences, postCollection, saveCollectionDraft, type ReferenceMatch } from "@/app/(app)/finance/collection-actions";
import { startNavigationProgress } from "@/components/app/navigation-progress";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormSection, NativeSelect, PendingButton } from "@/components/shared/form";
import type { EditorAccount, EditorMethod, EditorOption } from "@/lib/data/collections";
import { createClient } from "@/lib/supabase/client";

export type EditorEntry = {
  category_id: string;
  payment_method_id: string;
  financial_account_id: string | null;
  donor_person_id: string | null;
  amount: number;
  reference_number: string | null;
  notes: string | null;
};

export type EditorCollection = {
  id: string;
  collection_name: string;
  collection_date: string;
  service: string;
  entry_mode: "summary" | "detailed";
  notes: string;
  attachment_path: string | null;
  entries: EditorEntry[];
};

type Row = { key: string; donor: string; category: string; method: string; account: string; amount: string; reference: string; notes: string };

const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
// Which kinds of account a payment method normally lands in. Check and "other" can go anywhere.
const ACCOUNT_TYPES_FOR: Record<string, string[] | null> = { cash: ["cash"], e_wallet: ["e_wallet"], bank: ["bank"], check: null, other: null };

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
/** What was typed, as an amount. Anything that is not a positive number counts as nothing. */
const amountOf = (text: string) => {
  const value = Number(text.replace(/[,\s₱]/g, ""));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
};
const longDate = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) : "";
let rowCounter = 0;
const newKey = () => `row-${(rowCounter += 1)}`;

/**
 * One screen for a whole collection: a Sunday's giving entered together.
 * Summary mode takes totals per category and payment method; detailed mode
 * takes one row per gift. Totals update as you type. Nothing reaches the
 * ledger until the collection is posted.
 */
export function CollectionEditor({
  initial,
  today,
  categories,
  methods,
  accounts,
  services,
  defaultService,
  donors,
}: {
  initial: EditorCollection | null;
  today: string;
  categories: EditorOption[];
  methods: EditorMethod[];
  accounts: EditorAccount[];
  services: EditorOption[];
  defaultService: string;
  /** Members to choose a giver from. Null when the church does not track individual giving. */
  donors: EditorOption[] | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"draft" | "post" | null>(null);

  const accountsFor = (methodId: string) => {
    const types = ACCOUNT_TYPES_FOR[methods.find((method) => method.id === methodId)?.kind ?? "other"];
    return accounts.filter((account) => !types || types.includes(account.account_type));
  };
  /** Cash goes to the cash account, GCash to the e-wallet, and so on; it can be changed. */
  const defaultAccount = (methodId: string) => accountsFor(methodId)[0]?.id ?? "";
  const donorLabel = (id: string | null) => donors?.find((donor) => donor.value === id)?.label ?? "";

  // --- Details ---------------------------------------------------------------
  const [date, setDate] = useState(initial?.collection_date ?? today);
  const [service, setService] = useState(initial?.service ?? defaultService);
  const serviceLabel = (value: string) => services.find((option) => option.value === value)?.label.replace(/ \(event\)$/, "") ?? "";
  const suggestedName = (forService: string, forDate: string) => [serviceLabel(forService) || "Collection", longDate(forDate)].filter(Boolean).join(" - ");
  const [name, setName] = useState(initial?.collection_name ?? suggestedName(defaultService, today));
  // The name follows the service and date until someone types their own.
  const [nameEdited, setNameEdited] = useState(Boolean(initial));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [mode, setMode] = useState<"summary" | "detailed">(initial?.entry_mode ?? "summary");
  const [attachmentPath, setAttachmentPath] = useState(initial?.attachment_path ?? "");
  const [attachment, setAttachment] = useState<File | null>(null);

  function changeDate(next: string) {
    setDate(next);
    if (!nameEdited) setName(suggestedName(service, next));
  }
  function changeService(next: string) {
    setService(next);
    if (!nameEdited) setName(suggestedName(next, date));
  }

  // --- Summary mode: one amount per category and payment method --------------
  const [cells, setCells] = useState<Record<string, string>>(() => {
    const totals: Record<string, number> = {};
    for (const entry of initial?.entries ?? []) {
      const key = `${entry.category_id}|${entry.payment_method_id}`;
      totals[key] = (totals[key] ?? 0) + entry.amount;
    }
    return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, String(value)]));
  });
  const [methodAccount, setMethodAccount] = useState<Record<string, string>>(() => {
    const chosen: Record<string, string> = {};
    for (const method of methods) chosen[method.id] = defaultAccount(method.id);
    for (const entry of initial?.entries ?? []) if (entry.financial_account_id) chosen[entry.payment_method_id] = entry.financial_account_id;
    return chosen;
  });

  // --- Detailed mode: one row per gift ----------------------------------------
  const blankRow = (from?: Row): Row => {
    const method = from?.method ?? methods.find((item) => item.kind === "cash")?.id ?? methods[0]?.id ?? "";
    // A new row starts like the one above it: most gifts in a sitting are alike.
    return { key: newKey(), donor: "", category: from?.category ?? categories[0]?.value ?? "", method, account: from?.account ?? defaultAccount(method), amount: "", reference: "", notes: "" };
  };
  const [rows, setRows] = useState<Row[]>(() => {
    const existing = (initial?.entries ?? []).map((entry) => ({
      key: newKey(),
      donor: donorLabel(entry.donor_person_id),
      category: entry.category_id,
      method: entry.payment_method_id,
      account: entry.financial_account_id ?? "",
      amount: String(entry.amount),
      reference: entry.reference_number ?? "",
      notes: entry.notes ?? "",
    }));
    return existing.length > 0 ? existing : [blankRow()];
  });
  const setRow = (key: string, change: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const container = useRef<HTMLDivElement>(null);
  function addRow() {
    const row = blankRow(rows[rows.length - 1]);
    setRows((current) => [...current, row]);
    // Straight to the new row's first field, so the keyboard never has to stop.
    requestAnimationFrame(() => container.current?.querySelector<HTMLElement>(`[data-row="${row.key}"] :is([data-first], button[aria-label="Category"])`)?.focus());
  }
  /** Enter moves on: to the next amount in summary mode, to a new row at the end of a detailed row. */
  function onAmountKey(event: KeyboardEvent<HTMLInputElement>, lastOfRow?: { key: string }) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (lastOfRow) {
      if (rows[rows.length - 1]?.key === lastOfRow.key) addRow();
      return;
    }
    const inputs = [...(container.current?.querySelectorAll<HTMLInputElement>("input[data-amount]") ?? [])].filter((input) => input.offsetParent !== null);
    inputs[inputs.indexOf(event.currentTarget) + 1]?.focus();
  }

  function switchMode(next: "summary" | "detailed") {
    if (next === mode) return;
    if (next === "detailed") {
      // Every total becomes a row, ready to be split up or given a donor.
      const fromCells = categories.flatMap((category) =>
        methods
          .filter((method) => amountOf(cells[`${category.value}|${method.id}`] ?? "") > 0)
          .map((method) => ({
            key: newKey(),
            donor: "",
            category: category.value,
            method: method.id,
            account: methodAccount[method.id] ?? "",
            amount: String(amountOf(cells[`${category.value}|${method.id}`] ?? "")),
            reference: "",
            notes: "",
          })),
      );
      setRows(fromCells.length > 0 ? fromCells : [blankRow()]);
    } else {
      const totals: Record<string, number> = {};
      const used = rows.filter((row) => amountOf(row.amount) > 0 && row.category && row.method);
      for (const row of used) totals[`${row.category}|${row.method}`] = (totals[`${row.category}|${row.method}`] ?? 0) + amountOf(row.amount);
      setCells(Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, String(value)])));
      if (used.some((row) => row.donor || row.reference || row.notes)) {
        toast.info("Summary mode keeps totals only: donors, references and notes of individual rows are not carried over.");
      }
    }
    setMode(next);
  }

  // --- What will be saved, and the live totals --------------------------------
  const entries = useMemo(() => {
    if (mode === "summary") {
      return categories.flatMap((category) =>
        methods
          .filter((method) => amountOf(cells[`${category.value}|${method.id}`] ?? "") > 0)
          .map((method) => ({
            category_id: category.value,
            payment_method_id: method.id,
            financial_account_id: methodAccount[method.id] ?? "",
            donor_person_id: "",
            amount: amountOf(cells[`${category.value}|${method.id}`] ?? ""),
            reference_number: "",
            notes: "",
          })),
      );
    }
    return rows
      .filter((row) => amountOf(row.amount) > 0)
      .map((row) => ({
        category_id: row.category,
        payment_method_id: row.method,
        financial_account_id: row.account,
        donor_person_id: donors?.find((donor) => donor.label === row.donor.trim())?.value ?? "",
        amount: amountOf(row.amount),
        reference_number: row.reference.trim(),
        notes: row.notes.trim(),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cells, rows, methodAccount]);

  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const byMethod = methods
    .map((method) => ({ label: method.name, amount: entries.filter((entry) => entry.payment_method_id === method.id).reduce((sum, entry) => sum + entry.amount, 0) }))
    .filter((item) => item.amount > 0);
  const byCategory = categories
    .map((category) => ({ label: category.label, amount: entries.filter((entry) => entry.category_id === category.value).reduce((sum, entry) => sum + entry.amount, 0) }))
    .filter((item) => item.amount > 0);

  /** The first thing that would stop this collection from being saved, in plain words. */
  function problem(forPosting: boolean): string | null {
    if (!name.trim()) return "Give the collection a name.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Choose the collection date.";
    if (mode === "detailed") {
      for (const [index, row] of rows.entries()) {
        const filled = amountOf(row.amount) > 0;
        if (!filled && (row.amount.trim() || row.reference.trim() || row.donor.trim())) return `Row ${index + 1}: enter an amount more than zero, or clear the row.`;
        if (!filled) continue;
        if (!row.category) return `Row ${index + 1}: choose a giving category.`;
        if (!row.method) return `Row ${index + 1}: choose a payment method.`;
        if (!row.account && accountsFor(row.method).length > 0) return `Row ${index + 1}: choose the account that received it.`;
        if (row.donor.trim() && !donors?.some((donor) => donor.label === row.donor.trim())) {
          return `Row ${index + 1}: choose the member from the list, or leave the donor empty for anonymous giving.`;
        }
        if (forPosting && !row.reference.trim() && methods.find((method) => method.id === row.method)?.requires_reference) {
          return `Row ${index + 1}: ${methods.find((method) => method.id === row.method)?.name} needs a reference number.`;
        }
      }
    } else {
      const missing = methods.find((method) => entries.some((entry) => entry.payment_method_id === method.id) && !methodAccount[method.id] && accountsFor(method.id).length > 0);
      if (missing) return `Choose the account that receives ${missing.name}.`;
    }
    if (forPosting && entries.length === 0) return "Enter at least one amount before posting.";
    return null;
  }

  async function payload() {
    let path = attachmentPath;
    if (attachment) {
      const extension = (attachment.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      path = `collection-${crypto.randomUUID()}.${extension}`;
      const { error } = await createClient().storage.from("payment-proofs").upload(path, attachment, { contentType: attachment.type });
      if (error) {
        toast.error("The attachment could not be uploaded. Nothing was saved.");
        return null;
      }
      setAttachmentPath(path);
      setAttachment(null);
    }
    return { collection_name: name, collection_date: date, service, entry_mode: mode, notes, attachment_path: path, entries };
  }

  function saveDraft() {
    const found = problem(false);
    if (found) {
      toast.error(found);
      return;
    }
    setAction("draft");
    startTransition(async () => {
      const data = await payload();
      if (!data) return;
      const result = await saveCollectionDraft(initial?.id ?? null, data);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft saved. It is not in the reports until it is posted.");
      setReviewing(false);
      if (!initial) {
        startNavigationProgress();
        router.replace(`/finance/giving/collections/${result.data!.id}`);
      } else {
        router.refresh();
      }
    });
  }

  // --- Review, then post -------------------------------------------------------
  const [reviewing, setReviewing] = useState(false);
  const [duplicates, setDuplicates] = useState<ReferenceMatch[]>([]);
  const repeated = useMemo(() => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const entry of entries) {
      const reference = entry.reference_number.toLowerCase();
      if (!reference) continue;
      if (seen.has(reference)) twice.add(entry.reference_number);
      seen.add(reference);
    }
    return [...twice];
  }, [entries]);

  function review() {
    const found = problem(true);
    if (found) {
      toast.error(found);
      return;
    }
    setDuplicates([]);
    setReviewing(true);
    const references = entries.map((entry) => entry.reference_number).filter(Boolean);
    if (references.length > 0) {
      void findDuplicateReferences(initial?.id ?? null, references).then((result) => {
        if (result.ok) setDuplicates(result.data?.matches ?? []);
      });
    }
  }

  function post() {
    setAction("post");
    startTransition(async () => {
      const data = await payload();
      if (!data) return;
      const result = await postCollection(initial?.id ?? null, data);
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      toast.success(`Collection posted: ${peso.format(total)} in ${entries.length} ${entries.length === 1 ? "entry" : "entries"}.`);
      startNavigationProgress();
      router.replace(`/finance/giving/collections/${result.data!.id}`);
      router.refresh();
    });
  }

  const noSetup = categories.length === 0 || methods.length === 0;
  // One grid template for the header row and every category row of the summary table.
  const summaryColumns = { "--methods": methods.length } as CSSProperties;
  const summaryGrid = "md:grid md:grid-cols-[minmax(8rem,1.1fr)_repeat(var(--methods),minmax(6.5rem,1fr))_minmax(7rem,0.8fr)] md:items-center md:gap-2";
  const detailGrid = donors
    ? "md:grid md:grid-cols-[minmax(9rem,1.3fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_minmax(8rem,1.1fr)_minmax(6.5rem,0.8fr)_minmax(6.5rem,0.9fr)_2rem] md:items-center md:gap-2"
    : "md:grid md:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(9rem,1.2fr)_minmax(7rem,0.8fr)_minmax(7rem,1fr)_2rem] md:items-center md:gap-2";

  if (noSetup) {
    return (
      <FormSection title="Finance settings needed">
        <p className="text-sm text-muted-foreground">
          A collection needs at least one giving category and one payment method.{" "}
          <Link href="/finance/settings" className="font-medium text-link hover:underline">
            Add them under Finance settings
          </Link>
          .
        </p>
      </FormSection>
    );
  }

  return (
    <div ref={container} className="space-y-4">
      <FormSection title="Collection details">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date" htmlFor="collection_date" required>
            <Input id="collection_date" type="date" value={date} onChange={(event) => changeDate(event.target.value)} />
          </Field>
          <Field label="Service / event" htmlFor="collection_service">
            <NativeSelect id="collection_service" value={service} onChange={(event) => changeService(event.target.value)}>
              <option value="">Not specified</option>
              {services.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Collection name" htmlFor="collection_name" required className="sm:col-span-2">
            <Input
              id="collection_name"
              maxLength={160}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameEdited(true);
              }}
            />
          </Field>
          <Field label="Notes" htmlFor="collection_notes" className="sm:col-span-2 lg:col-span-4">
            <Textarea id="collection_notes" rows={2} maxLength={1000} placeholder="Optional notes…" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </div>

        <fieldset className="mt-5 border-t pt-4">
          <legend className="sr-only">Entry mode</legend>
          <p className="mb-2 text-sm font-medium">Entry mode</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { value: "summary", label: "Summary", hint: "Totals by category and payment method. The fastest way to record a service." },
                { value: "detailed", label: "Detailed / individual", hint: "One row per gift, with an optional donor and reference number." },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${mode === option.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
              >
                <input type="radio" name="entry_mode" className="mt-1 accent-primary" checked={mode === option.value} onChange={() => switchMode(option.value)} />
                <span>
                  <span className="font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </FormSection>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
        <FormSection
          title={mode === "summary" ? "Summary entry" : "Giving entries"}
          description={
            mode === "summary"
              ? "Type the total for each category and payment method. Press Enter or Tab to move to the next amount. Leave the rest empty."
              : "One row per gift. Tab moves between fields; Enter on the amount or reference of the last row starts a new one."
          }
        >
          {mode === "summary" ? (
            <div style={summaryColumns}>
              {/* Where each payment method lands. Suggested from the method; changeable. */}
              <div className="mb-4 grid gap-3 rounded-lg border bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-3">
                {methods.map((method) => (
                  <Field key={method.id} label={`${method.name} goes to`} htmlFor={`account-${method.id}`}>
                    <NativeSelect id={`account-${method.id}`} value={methodAccount[method.id] ?? ""} onChange={(event) => setMethodAccount((current) => ({ ...current, [method.id]: event.target.value }))}>
                      <option value="">No account</option>
                      {accountsFor(method.id).map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ))}
              </div>

              <div className={`hidden border-b pb-2 text-xs font-medium text-muted-foreground ${summaryGrid}`} aria-hidden>
                <span>Category</span>
                {methods.map((method) => (
                  <span key={method.id} className="text-right">
                    {method.name}
                  </span>
                ))}
                <span className="text-right">Subtotal</span>
              </div>
              <div className="space-y-3 md:space-y-0">
                {categories.map((category) => {
                  const subtotal = methods.reduce((sum, method) => sum + amountOf(cells[`${category.value}|${method.id}`] ?? ""), 0);
                  return (
                    <div key={category.value} className={`rounded-xl border p-3 md:rounded-none md:border-0 md:border-b md:px-0 md:py-2 ${summaryGrid}`}>
                      <p className="mb-2 text-sm font-semibold md:mb-0">{category.label}</p>
                      <div className="grid grid-cols-2 gap-2 md:contents">
                        {methods.map((method) => {
                          const key = `${category.value}|${method.id}`;
                          return (
                            <label key={method.id} className="block">
                              <span className="mb-1 block text-xs text-muted-foreground md:sr-only">
                                {method.name}
                                <span className="sr-only"> for {category.label}</span>
                              </span>
                              <Input
                                data-amount=""
                                inputMode="decimal"
                                placeholder="0.00"
                                value={cells[key] ?? ""}
                                onChange={(event) => setCells((current) => ({ ...current, [key]: event.target.value }))}
                                onKeyDown={(event) => onAmountKey(event)}
                                className="text-right tabular-nums"
                              />
                            </label>
                          );
                        })}
                      </div>
                      <p className="mt-2 flex justify-between text-sm md:mt-0 md:block md:text-right">
                        <span className="text-muted-foreground md:hidden">Subtotal</span>
                        <span className="font-semibold tabular-nums">{peso.format(subtotal)}</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {donors ? (
                <datalist id="collection-donors">
                  {donors.map((donor) => (
                    <option key={donor.value} value={donor.label} />
                  ))}
                </datalist>
              ) : null}
              <div className={`hidden border-b pb-2 text-xs font-medium text-muted-foreground ${detailGrid}`} aria-hidden>
                {donors ? <span>Donor (optional)</span> : null}
                <span>Category</span>
                <span>Payment</span>
                <span>Account</span>
                <span className="text-right">Amount</span>
                <span>Reference</span>
                <span />
              </div>
              <div className="space-y-3 md:space-y-0">
                {rows.map((row, index) => {
                  const method = methods.find((item) => item.id === row.method);
                  const label = (text: string) => <span className="mb-1 block text-xs text-muted-foreground md:sr-only">{text}</span>;
                  return (
                    <div key={row.key} data-row={row.key} className={`relative space-y-2 rounded-xl border p-3 md:space-y-0 md:rounded-none md:border-0 md:border-b md:px-0 md:py-2 ${detailGrid}`}>
                      <p className="text-xs font-medium text-muted-foreground md:hidden">Entry {index + 1}</p>
                      {donors ? (
                        <label className="block">
                          {label("Donor (optional)")}
                          <Input data-first="" list="collection-donors" placeholder="Anonymous" value={row.donor} onChange={(event) => setRow(row.key, { donor: event.target.value })} />
                        </label>
                      ) : null}
                      <div className="grid grid-cols-2 gap-2 md:contents">
                        <div>
                          {label("Category")}
                          <NativeSelect aria-label="Category" value={row.category} onChange={(event) => setRow(row.key, { category: event.target.value })}>
                            {categories.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                        <div>
                          {label("Payment")}
                          <NativeSelect
                            aria-label="Payment method"
                            value={row.method}
                            // The account follows the method: Cash to the cash account, GCash to the e-wallet.
                            onChange={(event) => setRow(row.key, { method: event.target.value, account: defaultAccount(event.target.value) })}
                          >
                            {methods.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      </div>
                      <div>
                        {label("Account")}
                        <NativeSelect aria-label="Account" value={row.account} onChange={(event) => setRow(row.key, { account: event.target.value })}>
                          <option value="">No account</option>
                          {accountsFor(row.method).map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:contents">
                        <label className="block">
                          {label("Amount")}
                          <Input
                            data-amount=""
                            inputMode="decimal"
                            placeholder="0.00"
                            value={row.amount}
                            onChange={(event) => setRow(row.key, { amount: event.target.value })}
                            onKeyDown={(event) => onAmountKey(event, { key: row.key })}
                            className="text-right tabular-nums"
                          />
                        </label>
                        <label className="block">
                          {label(method?.requires_reference ? "Reference (required)" : "Reference")}
                          <Input
                            placeholder={method?.requires_reference ? "Required" : ""}
                            value={row.reference}
                            maxLength={120}
                            onChange={(event) => setRow(row.key, { reference: event.target.value })}
                            onKeyDown={(event) => onAmountKey(event, { key: row.key })}
                          />
                        </label>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove entry ${index + 1}`}
                        className="absolute right-1 top-1 md:static"
                        onClick={() => setRows((current) => (current.length === 1 ? [blankRow()] : current.filter((item) => item.key !== row.key)))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Button type="button" variant="outline" className="mt-3" onClick={addRow}>
                <Plus /> Add row
              </Button>
            </>
          )}

          <div className="mt-5 border-t pt-4">
            <p className="text-sm font-medium">Collection attachment (optional)</p>
            <p className="mb-2 text-xs text-muted-foreground">A reconciliation sheet, GCash summary screenshot or deposit slip. Image or PDF, up to 5 MB. Stored privately.</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className={`${buttonVariants({ variant: "outline", size: "sm" })} cursor-pointer`}>
                <Paperclip /> {attachment || attachmentPath ? "Replace file" : "Choose file"}
                <input
                  type="file"
                  accept={ATTACHMENT_TYPES.join(",")}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    if (!ATTACHMENT_TYPES.includes(file.type)) return void toast.error("Please choose an image or a PDF.");
                    if (file.size > MAX_ATTACHMENT_BYTES) return void toast.error("That file is larger than 5 MB.");
                    setAttachment(file);
                  }}
                />
              </label>
              <span className="min-w-0 truncate text-muted-foreground">{attachment?.name ?? (attachmentPath ? "A file is attached" : "No file")}</span>
              {attachment || attachmentPath ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAttachment(null);
                    setAttachmentPath("");
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        </FormSection>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <FormSection title="Collection summary">
            <Breakdown title="By payment method" items={byMethod} />
            <Breakdown title="By category" items={byCategory} />
            <div className="flex items-baseline justify-between border-t pt-3">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-xl font-semibold tabular-nums">{peso.format(total)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}. Updates as you type; nothing is saved until you save.
            </p>
          </FormSection>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm">
          <span className="text-muted-foreground">Grand total </span>
          <span className="text-lg font-semibold tabular-nums">{peso.format(total)}</span>
        </p>
        <div className="flex gap-2">
          <PendingButton variant="outline" pending={pending && action === "draft"} pendingText="Saving…" disabled={pending} onClick={saveDraft} className="flex-1 sm:flex-none">
            Save as draft
          </PendingButton>
          <Button onClick={review} disabled={pending} className="flex-1 sm:flex-none">
            Review collection
          </Button>
        </div>
      </div>

      <Dialog open={reviewing} onOpenChange={(next) => !pending && setReviewing(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Review collection</DialogTitle>
            <DialogDescription>Check the totals against the counted money before posting.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Collection</dt>
            <dd className="text-right font-medium">{name}</dd>
            <dt className="text-muted-foreground">Date</dt>
            <dd className="text-right">{longDate(date)}</dd>
            <dt className="text-muted-foreground">Entries</dt>
            <dd className="text-right tabular-nums">{entries.length}</dd>
          </dl>
          <div className="rounded-lg border p-3">
            <Breakdown title="By payment method" items={byMethod} />
            <Breakdown title="By category" items={byCategory} />
            <div className="flex items-baseline justify-between border-t pt-3">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-xl font-semibold tabular-nums">{peso.format(total)}</span>
            </div>
          </div>
          {duplicates.length > 0 || repeated.length > 0 ? (
            <div className="flex gap-2 rounded-lg bg-warning/15 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium">Possible duplicate transaction</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {repeated.map((reference) => (
                    <li key={`twice-${reference}`}>Reference {reference} appears more than once in this collection.</li>
                  ))}
                  {duplicates.map((match, index) => (
                    <li key={`${match.reference_number}-${index}`}>
                      Reference {match.reference_number}: a {match.payment_method_name ?? "giving"} transaction on {longDate(match.giving_date)}
                      {match.collection_name ? ` (${match.collection_name})` : ""} already exists.{" "}
                      <Link href={`/finance/giving?q=${encodeURIComponent(match.reference_number)}`} target="_blank" className="font-medium text-link hover:underline">
                        Review existing
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">Go back to fix it, or post anyway if these really are separate transactions.</p>
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Once posted, these transactions are included in Finance reports and account balances. A posted collection cannot be edited; it can be voided.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(false)} disabled={pending}>
              Back to edit
            </Button>
            <PendingButton pending={pending && action === "post"} pendingText="Posting…" disabled={pending} onClick={post}>
              Confirm &amp; post {peso.format(total)}
            </PendingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Breakdown({ title, items }: { title: string; items: { label: string; amount: number }[] }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing entered yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item) => (
            <li key={item.label} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="tabular-nums">{peso.format(item.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
