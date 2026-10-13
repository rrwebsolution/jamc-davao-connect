import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Database, Inbox, ShieldAlert } from "lucide-react";
import { RetryButton } from "@/components/shared/retry-button";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function NoAccess() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="You don't have access to this page"
      description="If you think you should, ask a Super Admin to review your role."
    />
  );
}

/**
 * Shown in place of the content when loading it failed. The user stays on
 * the page they chose and can try again.
 */
export function LoadError({ what = "this page" }: { what?: string }) {
  return (
    <EmptyState
      icon={Database}
      title={`Unable to load ${what}.`}
      description="Please try again. If it keeps happening, contact your administrator."
      action={<RetryButton />}
    />
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-16" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-8 w-full sm:w-72" />
        <Skeleton className="h-8 w-full sm:w-40" />
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b p-3 last:border-b-0">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="hidden h-4 w-24 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 2 }, (_, s) => (
        <div key={s} className="rounded-xl border bg-card p-4 sm:p-6">
          <Skeleton className="h-5 w-40" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-xl border bg-card p-4 sm:p-6">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <FormSkeleton />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-4 h-52 w-full" />
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div className="mb-5">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
    </div>
  );
}

export const StatsCardSkeleton = CardsSkeleton;

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b p-4">
        <Skeleton className="h-5 w-40" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 border-b p-3 last:border-b-0">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-8 w-full sm:w-72" />
        <Skeleton className="h-8 w-full sm:w-40" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/2" />
            <Skeleton className="mt-4 h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

const BODIES = {
  table: () => <TableSkeleton />,
  cards: () => <CardGridSkeleton />,
  form: () => <FormSkeleton />,
  detail: () => (
    <div className="space-y-4">
      <StatsCardSkeleton count={4} />
      <ListSkeleton />
    </div>
  ),
  dashboard: () => (
    <div className="space-y-4">
      <StatsCardSkeleton count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ListSkeleton rows={3} />
        <ListSkeleton rows={3} />
      </div>
    </div>
  ),
  finance: () => (
    <div className="space-y-4">
      <StatsCardSkeleton count={5} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  ),
  report: () => (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-8 w-full sm:w-44" />
        <Skeleton className="h-8 w-full sm:w-44" />
        <Skeleton className="h-8 w-full sm:w-40" />
      </div>
      <TableSkeleton rows={10} />
    </div>
  ),
} as const;

/**
 * What a page shows the instant it is opened, before its data arrives.
 * With a `title` the real heading is there immediately and only the content
 * below it is a skeleton; without one (record pages, whose title is the
 * record's name) the heading is a skeleton too.
 */
export function PageSkeleton({
  title,
  description,
  variant = "table",
}: {
  title?: string;
  description?: string;
  variant?: keyof typeof BODIES;
}) {
  return (
    <div aria-busy="true">
      {title ? <PageHeader title={title} description={description} /> : <PageHeaderSkeleton />}
      <span className="sr-only">Loading…</span>
      {BODIES[variant]()}
    </div>
  );
}
