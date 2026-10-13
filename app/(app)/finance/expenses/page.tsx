import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { FinanceLedger } from "@/components/finance/finance-ledger";
import { PageSkeleton } from "@/components/shared/states";

export const metadata: Metadata = { title: "Expenses" };

export default function Page({ searchParams }: PageProps<"/finance/expenses">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Expenses" description="Money the church has spent." />}>
      <FinanceLedger kind="expenses" searchParams={searchParams} />
    </PageBoundary>
  );
}