import type { ReactNode } from "react";
import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { Bars, RankedBars, type ChartPoint } from "@/components/dashboard/charts";
import { buttonVariants } from "@/components/ui/button";
import { money, StatTile } from "@/components/shared/blocks";
import { FilterBar } from "@/components/shared/filter-bar";
import { DateFilter } from "@/components/shared/list-controls";
import { LoadError, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { parseListParams } from "@/lib/data/common";
import { formatMonth, titleCase } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { describeError } from "@/lib/errors";

export const metadata: Metadata = { title: "Finance" };

type Stats = {
  total_giving: number;
  total_expenses: number;
  balance: number;
  giving_this_month: number;
  expenses_this_month: number;
  trend: { month: string; giving: number; expenses: number }[];
  giving_by_category: { name: string; amount: number }[];
  expenses_by_category: { name: string; amount: number }[];
};

function ChartCard({ title, description, data, empty, children }: { title: string; description: string; data: ChartPoint[]; empty: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      {data.some((point) => point.value > 0) ? (
        <>
          {children}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">View as table</summary>
            <table className="mt-2 w-full text-left text-xs">
              <tbody>
                {data.map((point, index) => (
                  <tr key={index} className="border-b last:border-b-0">
                    <td className="py-1">{point.label}</td>
                    <td className="py-1 text-right tabular-nums">{money(point.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : (
        <p className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

async function FinanceContent({ searchParams }: Pick<PageProps<"/finance">, "searchParams">) {
  const access = await requireAccess();
  if (!can(access, "finance.view")) {
    return <NoAccess />;
  }
  const { params } = parseListParams(await searchParams);
  const isDate = (value?: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

  const supabase = await createClient();
  const range = { from_date: isDate(params.from), to_date: isDate(params.to) };
  const [{ data, error }, byMethodResult, balancesResult] = await Promise.all([
    supabase.rpc("finance_stats", range),
    supabase.rpc("giving_by_payment_method", range),
    // Balances are always "as of now": opening balance plus every record and transfer.
    supabase.rpc("account_statement", { from_date: null, to_date: null }),
  ]);
  const byMethod = ((byMethodResult.data ?? []) as { method_name: string; amount: number }[]).map((row) => ({
    label: row.method_name,
    value: Number(row.amount),
  }));
  const balances = (balancesResult.data ?? []) as { account_id: string; account_name: string; account_type: string; closing_balance: number }[];
  const stats = data as Stats | null;
  if (error || !stats) {
    console.error("finance_stats failed", describeError(error));
    return <LoadError what="the finance dashboard" />;
  }

  const ranged = Boolean(isDate(params.from) || isDate(params.to));
  const period = ranged ? "in the selected dates" : "all time";
  const givingTrend = stats.trend.map((row) => ({ label: formatMonth(row.month), value: Number(row.giving) }));
  const expenseTrend = stats.trend.map((row) => ({ label: formatMonth(row.month), value: Number(row.expenses) }));
  const givingByCategory = stats.giving_by_category.map((row) => ({ label: row.name, value: Number(row.amount) }));
  const expensesByCategory = stats.expenses_by_category.map((row) => ({ label: row.name, value: Number(row.amount) }));

  return (
    <>
      <PageHeader
        title="Finance"
        description="Giving, expenses and the balance between them."
        actions={
          <>
            <Link href="/finance/giving" className={buttonVariants({ variant: "outline" })}>
              Giving
            </Link>
            <Link href="/finance/expenses" className={buttonVariants({ variant: "outline" })}>
              Expenses
            </Link>
            <Link href="/finance/transfers" className={buttonVariants({ variant: "outline" })}>
              Transfers
            </Link>
            <Link href="/finance/settings" className={buttonVariants({ variant: "outline" })}>
              Settings
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <FilterBar params={params}>
          <DateFilter params={params} paramKey="from" label="From" />
          <DateFilter params={params} paramKey="to" label="To" />
          {ranged ? (
            <Link href="/finance" className="text-sm text-link hover:underline">
              Clear dates
            </Link>
          ) : null}
        </FilterBar>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Total giving" value={money(stats.total_giving)} note={period} />
        <StatTile label="Total expenses" value={money(stats.total_expenses)} note={period} />
        <StatTile label="Current balance" value={money(stats.balance)} note="All giving minus all expenses. Transfers do not change it." />
        <StatTile label="Giving this month" value={money(stats.giving_this_month)} />
        <StatTile label="Expenses this month" value={money(stats.expenses_this_month)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Giving trend" description="Giving received in each of the last 12 months." data={givingTrend} empty="No giving recorded yet.">
          <Bars data={givingTrend} unit="pesos" />
        </ChartCard>
        <ChartCard title="Expense trend" description="Expenses in each of the last 12 months." data={expenseTrend} empty="No expenses recorded yet.">
          <Bars data={expenseTrend} unit="pesos" />
        </ChartCard>
        <ChartCard title="Giving by category" description={`Totals ${period}.`} data={givingByCategory} empty="No giving in this period.">
          <RankedBars data={givingByCategory} unit="pesos" />
        </ChartCard>
        <ChartCard title="Expenses by category" description={`Totals ${period}.`} data={expensesByCategory} empty="No expenses in this period.">
          <RankedBars data={expensesByCategory} unit="pesos" />
        </ChartCard>
        <ChartCard title="Giving by payment method" description={`How giving was received, ${period}.`} data={byMethod} empty="No giving in this period.">
          <RankedBars data={byMethod} unit="pesos" />
        </ChartCard>

        <section className="rounded-xl border bg-card shadow-xs">
          <div className="flex items-center justify-between gap-2 border-b p-4">
            <div>
              <h2 className="text-base font-semibold">Account balances</h2>
              <p className="text-sm text-muted-foreground">Opening balance + giving − expenses ± transfers.</p>
            </div>
            <Link href="/reports/account-transactions" className="shrink-0 text-sm text-link hover:underline">
              Details
            </Link>
          </div>
          {balances.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No accounts yet. Add them in Finance settings.</p>
          ) : (
            <ul className="divide-y">
              {balances.map((account) => (
                <li key={account.account_id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{account.account_name}</span>
                    <span className="text-xs text-muted-foreground">{titleCase(account.account_type)}</span>
                  </span>
                  <span className={`shrink-0 font-semibold tabular-nums ${Number(account.closing_balance) < 0 ? "text-destructive" : ""}`}>
                    {money(account.closing_balance)}
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 bg-muted/50 p-3 text-sm">
                <span className="font-medium">All accounts</span>
                <span className="font-semibold tabular-nums">{money(balances.reduce((sum, account) => sum + Number(account.closing_balance), 0))}</span>
              </li>
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export default function FinancePage({ searchParams }: PageProps<"/finance">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Finance" description="Giving, expenses and the balance between them." variant="finance" />}>
      <FinanceContent searchParams={searchParams} />
    </PageBoundary>
  );
}