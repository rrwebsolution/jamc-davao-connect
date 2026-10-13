import Link from "next/link";
import { Paperclip, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { deleteExpense, deleteGiving, saveExpense, saveGiving } from "@/app/(app)/module-actions";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money } from "@/components/shared/blocks";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog, type FieldDef, type FormValues } from "@/components/shared/entity-dialog";
import { FilterBar } from "@/components/shared/filter-bar";
import { DateFilter, FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { EmptyState, LoadError, NoAccess, PageHeader } from "@/components/shared/states";
import { can } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { cleanSearchTerm, getChurchSettings, getChurchToday, isUuid, PAGE_SIZE, parseListParams, type RawSearchParams } from "@/lib/data/common";
import { getFinancialAccounts, getPaymentMethods, paymentFields } from "@/lib/data/finance";
import { getCategoryOptions, getPeopleOptions } from "@/lib/data/options";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { describeError } from "@/lib/errors";

type LedgerRow = {
  id: string;
  giving_date?: string;
  expense_date?: string;
  category_id: string;
  category_name: string;
  amount: number;
  description?: string;
  payee?: string | null;
  reference_number: string | null;
  notes: string | null;
  donor_person_id?: string | null;
  donor_name?: string | null;
  recorded_by_name: string | null;
  payment_method_id: string | null;
  payment_method_name: string | null;
  financial_account_id: string | null;
  account_name: string | null;
  check_number?: string | null;
  check_bank?: string | null;
  check_date?: string | null;
  proof_path?: string | null;
};

const PROOF_UPLOAD = {
  bucket: "payment-proofs",
  accept: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
  maxBytes: 5 * 1024 * 1024,
};

const CONFIG = {
  giving: {
    title: "Giving",
    description: "Tithes, offerings and other giving received.",
    view: "giving_details",
    table: "giving_records",
    dateColumn: "giving_date",
    categories: "giving_categories",
    path: "/finance/giving",
    noun: "giving record",
    empty: "No giving recorded yet.",
  },
  expenses: {
    title: "Expenses",
    description: "Money the church has spent.",
    view: "expense_details",
    table: "expenses",
    dateColumn: "expense_date",
    categories: "expense_categories",
    path: "/finance/expenses",
    noun: "expense",
    empty: "No expenses recorded yet.",
  },
} as const;

/** The Giving and Expenses pages: same list, filters and dialogs, different columns. */
export async function FinanceLedger({ kind, searchParams }: { kind: "giving" | "expenses"; searchParams: Promise<RawSearchParams> }) {
  const access = await requireAccess();
  // RLS returns nothing without finance.view; this just avoids an empty shell.
  if (!can(access, "finance.view")) {
    return <NoAccess />;
  }
  const config = CONFIG[kind];
  const isGiving = kind === "giving";
  const canManage = can(access, "finance.manage");
  const { params, page, from } = parseListParams(await searchParams);

  const supabase = await createClient();
  // The same filters go on two differently-typed queries (the list and the
  // total), which the query builder's generics can't express.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (query: any) => {
    let next = query;
    if (isUuid(params.category)) next = next.eq("category_id", params.category);
    if (isUuid(params.method)) next = next.eq("payment_method_id", params.method);
    if (isUuid(params.account)) next = next.eq("financial_account_id", params.account);
    if (params.from) next = next.gte(config.dateColumn, params.from);
    if (params.to) next = next.lte(config.dateColumn, params.to);
    const term = cleanSearchTerm(params.q);
    if (term) {
      next = next.or(
        isGiving
          ? `reference_number.ilike.%${term}%,notes.ilike.%${term}%`
          : `description.ilike.%${term}%,payee.ilike.%${term}%,reference_number.ilike.%${term}%`,
      );
    }
    return next;
  };

  const [list, totalRows, categories, settings, today, methods, accounts] = await Promise.all([
    applyFilters(supabase.from(config.view).select("*", { count: "exact" }))
      .order(config.dateColumn, { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    // Total of everything matching the filters, not just this page.
    applyFilters(supabase.from(config.table).select("amount")).limit(20000),
    getCategoryOptions(config.categories),
    getChurchSettings(),
    getChurchToday(),
    getPaymentMethods(),
    getFinancialAccounts(),
  ]);
  if (list.error) {
    console.error(`Failed to load ${kind}`, describeError(list.error));
    return <LoadError what={`the ${config.title.toLowerCase()}`} />;
  }
  const rows = (list.data ?? []) as LedgerRow[];
  const filteredTotal = ((totalRows.data ?? []) as { amount: number }[]).reduce((sum, row) => sum + Number(row.amount), 0);
  const trackDonors = isGiving && settings.track_individual_giving;
  const donors = trackDonors && canManage ? await getPeopleOptions("member") : [];

  // Category (what for), payment method (how) and account (where) are separate fields.
  const payment = paymentFields(methods, accounts, isGiving ? "Received in (account)" : "Paid from (account)");
  const fields: FieldDef[] = isGiving
    ? [
        { name: "giving_date", label: "Date", type: "date", required: true },
        { name: "category_id", label: "Giving category", type: "select", options: categories, emptyLabel: "Choose a category…", required: true },
        { name: "amount", label: "Amount (₱)", type: "number", required: true },
        ...payment.fields,
        { name: "check_number", label: "Check number", type: "text", required: true, showWhen: { field: "payment_method_id", in: payment.checkMethodIds } },
        { name: "check_bank", label: "Bank name", type: "text", showWhen: { field: "payment_method_id", in: payment.checkMethodIds } },
        { name: "check_date", label: "Check date", type: "date", showWhen: { field: "payment_method_id", in: payment.checkMethodIds } },
        ...(trackDonors
          ? [{ name: "donor_person_id", label: "Given by (optional)", type: "select" as const, options: donors, emptyLabel: "Not recorded", wide: true }]
          : []),
        {
          name: "proof_path",
          label: "Proof of payment",
          type: "file",
          upload: PROOF_UPLOAD,
          wide: true,
          hint: "Receipt screenshot or deposit slip. Image or PDF, up to 5 MB. Stored privately.",
        },
        { name: "notes", label: "Notes", type: "textarea" },
      ]
    : [
        { name: "expense_date", label: "Date", type: "date", required: true },
        { name: "category_id", label: "Expense category", type: "select", options: categories, emptyLabel: "Choose a category…", required: true },
        { name: "description", label: "Description", type: "text", required: true, wide: true },
        { name: "amount", label: "Amount (₱)", type: "number", required: true },
        { name: "payee", label: "Payee", type: "text" },
        ...payment.fields,
        { name: "notes", label: "Notes", type: "textarea" },
      ];
  const cashMethod = methods.find((method) => method.kind === "cash");
  const cashAccounts = accounts.filter((account) => account.is_active && account.account_type === "cash");
  const valuesOf = (row?: LedgerRow): FormValues =>
    isGiving
      ? {
          giving_date: row?.giving_date ?? today,
          category_id: row?.category_id ?? "",
          amount: row ? String(row.amount) : "",
          // New entries start as Cash into the cash account, the most common case.
          payment_method_id: row ? (row.payment_method_id ?? "") : (cashMethod?.id ?? ""),
          financial_account_id: row ? (row.financial_account_id ?? "") : cashAccounts.length === 1 && cashMethod ? cashAccounts[0].id : "",
          reference_number: row?.reference_number ?? "",
          check_number: row?.check_number ?? "",
          check_bank: row?.check_bank ?? "",
          check_date: row?.check_date ?? "",
          proof_path: row?.proof_path ?? "",
          donor_person_id: row?.donor_person_id ?? "",
          notes: row?.notes ?? "",
        }
      : {
          expense_date: row?.expense_date ?? today,
          category_id: row?.category_id ?? "",
          description: row?.description ?? "",
          amount: row ? String(row.amount) : "",
          payee: row?.payee ?? "",
          payment_method_id: row ? (row.payment_method_id ?? "") : (cashMethod?.id ?? ""),
          financial_account_id: row ? (row.financial_account_id ?? "") : cashAccounts.length === 1 && cashMethod ? cashAccounts[0].id : "",
          reference_number: row?.reference_number ?? "",
          notes: row?.notes ?? "",
        };
  const save = isGiving ? saveGiving : saveExpense;
  const remove = isGiving ? deleteGiving : deleteExpense;
  const dateOf = (row: LedgerRow) => formatDate(isGiving ? row.giving_date : row.expense_date, settings.date_format);
  const hasFilters = Object.keys(params).some((key) => key !== "page" && key !== "new");

  const createButton = canManage ? (
    <EntityDialog
      title={isGiving ? "Add giving" : "Add expense"}
      description="The entry is recorded under your name."
      fields={fields}
      initial={valuesOf()}
      action={save.bind(null, null)}
      submitLabel="Save"
      successMessage={isGiving ? "Giving recorded" : "Expense recorded"}
      defaultOpen={params.new === "1"}
    >
      <Plus /> {isGiving ? "Add giving" : "Add expense"}
    </EntityDialog>
  ) : null;

  const actions = (row: LedgerRow) =>
    canManage || row.proof_path ? (
      <div className="flex items-center justify-end gap-1">
        {row.proof_path ? (
          <a
            href={`/finance/proof/${row.id}`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label="View proof of payment"
            title="View proof of payment"
          >
            <Paperclip />
          </a>
        ) : null}
        {canManage ? (
          <>
        <EntityDialog
          title={isGiving ? "Giving record" : "Expense"}
          description={row.recorded_by_name ? `Recorded by ${row.recorded_by_name}.` : undefined}
          fields={fields}
          initial={valuesOf(row)}
          action={save.bind(null, row.id)}
          successMessage="Changes saved"
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${config.noun}`}
        >
          <Pencil />
        </EntityDialog>
        <ConfirmButton
          action={remove.bind(null, row.id)}
          title={`Delete this ${config.noun}?`}
          description={`${money(row.amount)} on ${dateOf(row)}. The deletion is written to the activity log and can't be undone.`}
          confirmLabel="Delete"
          successMessage="Record deleted"
          destructive
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${config.noun}`}
        >
          <Trash2 />
        </ConfirmButton>
          </>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <>
            <Link href="/finance" className={buttonVariants({ variant: "outline" })}>
              Finance dashboard
            </Link>
            <Link href="/finance/transfers" className={buttonVariants({ variant: "outline" })}>
              Transfers
            </Link>
            {createButton}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput params={params} placeholder={isGiving ? "Search reference or notes…" : "Search description, payee, reference…"} />
        <FilterBar params={params}>
          <FilterSelect params={params} paramKey="category" label="Category" options={categories} />
          <FilterSelect params={params} paramKey="method" label="Payment method" options={methods.map((m) => ({ value: m.id, label: m.name }))} />
          <FilterSelect params={params} paramKey="account" label="Account" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
          <DateFilter params={params} paramKey="from" label="From" />
          <DateFilter params={params} paramKey="to" label="To" />
        </FilterBar>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={hasFilters ? "Nothing matches these filters." : config.empty}
          action={
            hasFilters ? (
              <Link href={config.path} className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : (
              createButton
            )
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {list.count} {list.count === 1 ? "record" : "records"} · total{" "}
            <span className="font-semibold text-foreground tabular-nums">{money(filteredTotal)}</span>
          </p>

          <ul className="space-y-2 md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 rounded-xl border bg-card p-3">
                <div className="min-w-0">
                  <p className="font-semibold tabular-nums">{money(row.amount)}</p>
                  <p className="truncate text-sm">{isGiving ? row.category_name : row.description}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[dateOf(row), isGiving ? row.donor_name : row.category_name, isGiving ? null : row.payee, row.payment_method_name, row.account_name, row.reference_number ?? (row.check_number ? `Check ${row.check_number}` : null)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {actions(row)}
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  {isGiving ? null : <TableHead>Description</TableHead>}
                  {isGiving ? null : <TableHead>Payee</TableHead>}
                  {trackDonors ? <TableHead>Given by</TableHead> : null}
                  <TableHead>Method</TableHead>
                  <TableHead>{isGiving ? "Received in" : "Paid from"}</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Recorded by</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{dateOf(row)}</TableCell>
                    <TableCell>{row.category_name}</TableCell>
                    {isGiving ? null : <TableCell className="whitespace-normal">{row.description}</TableCell>}
                    {isGiving ? null : <TableCell>{row.payee ?? "—"}</TableCell>}
                    {trackDonors ? <TableCell>{row.donor_name ?? "—"}</TableCell> : null}
                    <TableCell>{row.payment_method_name ?? <span className="text-muted-foreground">Not recorded</span>}</TableCell>
                    <TableCell>{row.account_name ?? "—"}</TableCell>
                    <TableCell>{row.reference_number ?? (row.check_number ? `Check ${row.check_number}` : "—")}</TableCell>
                    <TableCell>{row.recorded_by_name ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(row.amount)}</TableCell>
                    <TableCell>{actions(row)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination params={params} page={page} pageSize={PAGE_SIZE} total={list.count ?? 0} />
        </>
      )}
    </>
  );
}
