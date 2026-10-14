import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function StatTile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div data-reveal="" className="h-full rounded-xl border bg-card p-3 shadow-xs sm:p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums sm:text-2xl">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
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
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className={flush ? undefined : "p-4"}>{children}</div>
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
