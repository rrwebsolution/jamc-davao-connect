import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowRightLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteTransfer, saveTransfer } from "@/app/(app)/module-actions";
import { PageBoundary } from "@/components/app/page-boundary";
import { buttonVariants } from "@/components/ui/button";
import { money } from "@/components/shared/blocks";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { EntityDialog, type FieldDef, type FormValues } from "@/components/shared/entity-dialog";
import { FilterBar } from "@/components/shared/filter-bar";
import { DateFilter, FilterSelect, Pagination } from "@/components/shared/list-controls";
import { EmptyState, LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { getChurchSettings, getChurchToday, isUuid, getListParams } from "@/lib/data/common";
import { getFinancialAccounts } from "@/lib/data/finance";
import { describeError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Transfers" };

const DESCRIPTION = "Money moved between the church's own accounts. Not income and not an expense.";

type TransferRow = {
  id: string;
  from_account_id: string;
  to_account_id: string;
  from_account_name: string | null;
  to_account_name: string | null;
  amount: number;
  transfer_date: string;
  reference_number: string | null;
  notes: string | null;
  recorded_by_name: string | null;
};

async function TransfersContent({ searchParams }: Pick<PageProps<"/finance/transfers">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, "finance.view")) {
    return <NoAccess />;
  }
  const canManage = can(access, "finance.manage");
  const { params, page, from, pageSize } = await getListParams(await searchParams);

  const supabase = await createClient();
  let query = supabase.from("account_transfer_details").select("*", { count: "exact" });
  if (isUuid(params.account)) query = query.or(`from_account_id.eq.${params.account},to_account_id.eq.${params.account}`);
  if (params.from) query = query.gte("transfer_date", params.from);
  if (params.to) query = query.lte("transfer_date", params.to);

  const [list, accounts, settings, today] = await Promise.all([
    query.order("transfer_date", { ascending: false }).order("created_at", { ascending: false }).range(from, from + pageSize - 1),
    getFinancialAccounts(),
    getChurchSettings(),
    getChurchToday(),
  ]);
  if (list.error) {
    console.error("Failed to load transfers", describeError(list.error));
    return <LoadError what="the transfers" />;
  }
  const rows = (list.data ?? []) as TransferRow[];
  const options = accounts.filter((account) => account.is_active).map((account) => ({ value: account.id, label: account.name }));
  const hasFilters = Object.keys(params).some((key) => key !== "page" && key !== "new");

  const fields: FieldDef[] = [
    { name: "from_account_id", label: "From account", type: "select", options, emptyLabel: "Choose…", required: true },
    { name: "to_account_id", label: "To account", type: "select", options, emptyLabel: "Choose…", required: true },
    { name: "amount", label: "Amount (₱)", type: "number", required: true },
    { name: "transfer_date", label: "Transfer date", type: "date", required: true },
    { name: "reference_number", label: "Reference number", type: "text", wide: true },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const valuesOf = (row?: TransferRow): FormValues => ({
    from_account_id: row?.from_account_id ?? "",
    to_account_id: row?.to_account_id ?? "",
    amount: row ? String(row.amount) : "",
    transfer_date: row?.transfer_date ?? today,
    reference_number: row?.reference_number ?? "",
    notes: row?.notes ?? "",
  });

  const createButton =
    canManage && options.length >= 2 ? (
      <EntityDialog
        title="New transfer"
        description="Moves money from one church account to another. Totals for giving and expenses do not change."
        fields={fields}
        initial={valuesOf()}
        action={saveTransfer.bind(null, null)}
        submitLabel="Record transfer"
        successMessage="Transfer recorded"
        defaultOpen={params.new === "1"}
      >
        <Plus /> New transfer
      </EntityDialog>
    ) : null;

  return (
    <>
      <PageHeader
        title="Transfers"
        description={DESCRIPTION}
        actions={
          <>
            <Link href="/finance" className={buttonVariants({ variant: "outline" })}>
              Finance dashboard
            </Link>
            {createButton}
          </>
        }
      />

      {canManage && options.length < 2 ? (
        <p className="mb-4 rounded-lg border border-dashed bg-card p-3 text-sm text-muted-foreground">
          A transfer needs at least two accounts.{" "}
          <Link href="/finance/settings" className="text-link hover:underline">
            Add an account in Finance settings
          </Link>
          .
        </p>
      ) : null}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <FilterBar params={params}>
          <FilterSelect params={params} paramKey="account" label="Account" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
          <DateFilter params={params} paramKey="from" label="From" />
          <DateFilter params={params} paramKey="to" label="To" />
        </FilterBar>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ArrowRightLeft}
          title={hasFilters ? "No transfers match these filters." : "No transfers recorded yet."}
          description={hasFilters ? undefined : "Record one when money is deposited or moved, for example from GCash to the bank."}
          action={
            hasFilters ? (
              <Link href="/finance/transfers" className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            ) : (
              createButton
            )
          }
        />
      ) : (
        <>
          <ul className="divide-y rounded-xl border bg-card">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{row.from_account_name ?? "Account"}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
                    <span className="truncate">{row.to_account_name ?? "Account"}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[formatDate(row.transfer_date, settings.date_format), row.reference_number, row.recorded_by_name ? `by ${row.recorded_by_name}` : null, row.notes]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="mr-2 font-semibold tabular-nums">{money(row.amount)}</span>
                  {canManage ? (
                    <>
                      <EntityDialog
                        title="Transfer"
                        fields={fields}
                        initial={valuesOf(row)}
                        action={saveTransfer.bind(null, row.id)}
                        successMessage="Transfer updated"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit transfer"
                      >
                        <Pencil />
                      </EntityDialog>
                      <ConfirmButton
                        action={deleteTransfer.bind(null, row.id)}
                        title="Delete this transfer?"
                        description={`${money(row.amount)} from ${row.from_account_name} to ${row.to_account_name}. Both account balances go back to what they were. The deletion is written to the activity log.`}
                        confirmLabel="Delete"
                        successMessage="Transfer deleted"
                        destructive
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete transfer"
                      >
                        <Trash2 />
                      </ConfirmButton>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <Pagination params={params} page={page} pageSize={pageSize} total={list.count ?? 0} />
        </>
      )}
    </>
  );
}

export default function TransfersPage({ searchParams }: PageProps<"/finance/transfers">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Transfers" description={DESCRIPTION} />}>
      <TransfersContent searchParams={searchParams} />
    </PageBoundary>
  );
}
