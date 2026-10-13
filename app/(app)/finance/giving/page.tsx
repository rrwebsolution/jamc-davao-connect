import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import { FinanceLedger } from "@/components/finance/finance-ledger";
import { PageSkeleton } from "@/components/shared/states";

export const metadata: Metadata = { title: "Giving" };

export default function Page({ searchParams }: PageProps<"/finance/giving">) {
  return (
    <PageBoundary fallback={<PageSkeleton title="Giving" description="Tithes, offerings and other giving received." />}>
      <FinanceLedger kind="giving" searchParams={searchParams} />
    </PageBoundary>
  );
}