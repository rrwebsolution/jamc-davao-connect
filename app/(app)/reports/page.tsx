import type { Metadata } from "next";
import { PageBoundary } from "@/components/app/page-boundary";
import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";
import { EmptyState, NoAccess, PageHeader, PageSkeleton } from "@/components/shared/states";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { REPORTS } from "@/lib/data/reports";

export const metadata: Metadata = { title: "Reports" };

async function ReportsContent() {
  const access = await requireAccess();
  if (!can(access, P.reportsView)) {
    return <NoAccess />;
  }
  // Only the reports whose module the user can already open.
  const available = REPORTS.filter((report) => can(access, ...report.permissions));

  return (
    <>
      <PageHeader title="Reports" description="Each report shows only what you are allowed to see in its module." />
      {available.length === 0 ? (
        <EmptyState icon={BarChart3} title="No reports available to you." description="Reports follow your module permissions. Ask a Super Admin if you need access." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {available.map((report) => (
            <li key={report.slug}>
              <Link href={`/reports/${report.slug}`} className="flex h-full items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-ring">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{report.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{report.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <PageBoundary fallback={<PageSkeleton title="Reports" description="Each report shows only what you are allowed to see in its module." variant="cards" />}>
      <ReportsContent />
    </PageBoundary>
  );
}