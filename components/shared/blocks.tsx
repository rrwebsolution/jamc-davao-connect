import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "cn";

/**
 * A key figure: an icon in a soft circle, the label, the value and a short
 * note below it. Linked cards lift slightly on hover.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  note,
  href,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  note?: string;
  href?: string;
  /** Replaces the note, e.g. a trend line. */
  children?: ReactNode;
}) {
  const body = (
    <div className="flex h-full items-start gap-3">
      {Icon ? (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-primary max-sm:hidden sm:size-10">
          <Icon className="size-[18px]" aria-hidden />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground sm:text-sm">
          {Icon ? <Icon className="size-3.5 shrink-0 text-primary sm:hidden" aria-hidden /> : null}
          <span className="truncate">{label}</span>
        </p>
        <p className="mt-1 truncate text-2xl leading-tight font-semibold tracking-tight tabular-nums sm:text-[1.75rem]">{value}</p>
        {children ?? (note ? <p className="mt-1 truncate text-xs text-muted-foreground">{note}</p> : null)}
      </div>
    </div>
  );
  const className = "block h-full rounded-xl border bg-card p-3.5 shadow-xs sm:p-4";
  return href ? (
    <Link href={href} data-reveal="" className={cn(className, "motion-card transition-[border-color,box-shadow] duration-200 hover:border-ring/60 hover:shadow-sm")}>
      {body}
    </Link>
  ) : (
    <div data-reveal="" className={className}>
      {body}
    </div>
  );
}

/** A key figure without an icon or link. */
export function StatTile({ label, value, note, icon }: { label: string; value: string | number; note?: string; icon?: LucideIcon }) {
  return <StatCard label={label} value={value} note={note} icon={icon} />;
}

export function Panel({
  title,
  description,
  actions,
  children,
  flush = false,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Let the content run edge to edge (for lists and tables). */
  flush?: boolean;
}) {
  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <div className="flex flex-col gap-2 border-b px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className={flush ? undefined : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words whitespace-pre-line">{children || "—"}</dd>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden /> {children}
    </Link>
  );
}

export function ListEmpty({ children }: { children: ReactNode }) {
  return <p className="p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Peso amounts, e.g. ₱1,500.00. */
export function money(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value ?? 0));
}

export function formatTime(value: string | null | undefined) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}
