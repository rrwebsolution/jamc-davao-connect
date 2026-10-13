"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/shared/form";
import { cn } from "cn";

export type ListParams = Record<string, string | undefined>;

function buildHref(pathname: string, params: ListParams, changes: ListParams) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    if (value) {
      next.set(key, value);
    }
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Search box that updates the URL after a short pause in typing. */
export function SearchInput({
  params,
  placeholder = "Search…",
  paramKey = "q",
}: {
  params: ListParams;
  placeholder?: string;
  paramKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(params[paramKey] ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(() => {
        router.replace(buildHref(pathname, params, { [paramKey]: next.trim() || undefined, page: undefined }));
      });
    }, 350);
  }

  return (
    <div className="relative w-full sm:max-w-xs">
      {pending ? (
        <Loader2 className="absolute left-2.5 top-2 size-4 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden />
      )}
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
      />
    </div>
  );
}

/** A filter dropdown that writes its value to the URL. */
export function FilterSelect({
  params,
  paramKey,
  label,
  allLabel,
  options,
}: {
  params: ListParams;
  paramKey: string;
  label: string;
  /** Text of the empty option. Defaults to "<label>: All". */
  allLabel?: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <NativeSelect
      aria-label={label}
      value={params[paramKey] ?? ""}
      disabled={pending}
      onChange={(event) =>
        startTransition(() => {
          router.replace(buildHref(pathname, params, { [paramKey]: event.target.value || undefined, page: undefined }));
        })
      }
      className="w-full sm:w-auto sm:min-w-36"
    >
      <option value="">{allLabel ?? `${label}: All`}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Date filter that writes its value to the URL. */
export function DateFilter({ params, paramKey, label }: { params: ListParams; paramKey: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  return (
    <label className="flex w-full items-center gap-2 text-sm text-muted-foreground sm:w-auto">
      <span className="shrink-0">{label}</span>
      <Input
        type="date"
        defaultValue={params[paramKey] ?? ""}
        onChange={(event) =>
          startTransition(() => {
            router.replace(buildHref(pathname, params, { [paramKey]: event.target.value || undefined, page: undefined }));
          })
        }
      />
    </label>
  );
}

/** Column header that toggles sorting. */
export function SortLink({
  params,
  column,
  children,
}: {
  params: ListParams;
  column: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = params.sort === column;
  const nextDir = active && params.dir !== "desc" ? "desc" : "asc";
  const Icon = !active ? ChevronsUpDown : params.dir === "desc" ? ArrowDown : ArrowUp;

  return (
    <Link
      href={buildHref(pathname, params, { sort: column, dir: nextDir, page: undefined })}
      className="inline-flex items-center gap-1 hover:text-foreground"
      aria-label={`Sort by ${typeof children === "string" ? children : column}`}
    >
      {children}
      <Icon className={cn("size-3.5", active ? "text-foreground" : "opacity-50")} aria-hidden />
    </Link>
  );
}

export function Pagination({
  params,
  page,
  pageSize,
  total,
}: {
  params: ListParams;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pathname = usePathname();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) {
    return null;
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const link = (target: number, label: string, icon: ReactNode, disabled: boolean) =>
    disabled ? (
      <span className={cn(buttonVariants({ variant: "outline", size: "icon" }), "pointer-events-none opacity-40")} aria-hidden>
        {icon}
      </span>
    ) : (
      <Link
        href={buildHref(pathname, params, { page: target > 1 ? String(target) : undefined })}
        className={buttonVariants({ variant: "outline", size: "icon" })}
        aria-label={label}
      >
        {icon}
      </Link>
    );

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 text-sm text-muted-foreground sm:flex-row">
      <p>
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {link(page - 1, "Previous page", <ChevronLeft />, page <= 1)}
        <span className="tabular-nums">
          Page {page} of {pageCount}
        </span>
        {link(page + 1, "Next page", <ChevronRight />, page >= pageCount)}
      </div>
    </div>
  );
}
