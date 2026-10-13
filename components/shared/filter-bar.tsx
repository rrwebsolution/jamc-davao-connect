"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// URL parameters that are not filters.
const NOT_FILTERS = new Set(["q", "page", "sort", "dir", "new", "view", "month", "focus", "person"]);

/**
 * A page's filter controls. On tablets and desktops they sit in a row next to
 * the search box. On phones a row of dropdowns doesn't fit, so they move into
 * a sheet opened by one "Filters" button that shows how many are active.
 */
export function FilterBar({ params, children }: { params: Record<string, string | undefined>; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = Object.entries(params).filter(([key, value]) => value && !NOT_FILTERS.has(key)).length;
  const keepSearch = params.q ? `?q=${encodeURIComponent(params.q)}` : "";

  return (
    <>
      <div className="hidden flex-wrap items-center gap-2 md:contents">{children}</div>

      <Button variant="outline" className="w-full justify-center md:hidden" onClick={() => setOpen(true)}>
        <SlidersHorizontal /> Filters
        {active > 0 ? (
          <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
            {active}
          </span>
        ) : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] md:hidden">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>{active > 0 ? `${active} active` : "Narrow down the list."}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 overflow-y-auto p-5 [&_label]:w-full">{children}</div>
          <div className="flex gap-2 border-t p-4">
            {active > 0 ? (
              <Link href={`${pathname}${keepSearch}`} onClick={() => setOpen(false)} className={`${buttonVariants({ variant: "outline" })} flex-1`}>
                Clear all
              </Link>
            ) : null}
            <Button className="flex-1" onClick={() => setOpen(false)}>
              Show results
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
