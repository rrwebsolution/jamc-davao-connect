"use client";

import { Children, isValidElement, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// URL parameters that are not filters.
const NOT_FILTERS = new Set(["q", "page", "sort", "dir", "new", "view", "month", "focus", "person"]);

function Count({ value }: { value: number }) {
  return value > 0 ? (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
      {value}
    </span>
  ) : null;
}

/**
 * A page's filter controls. On tablets and desktops the first `inline` of them
 * sit in a row next to the search box and the rest open from a filter button
 * in a side panel; without `inline` all of them sit in the row. On phones a row
 * of dropdowns doesn't fit, so they all move into a sheet opened by one
 * "Filters" button that shows how many are active.
 */
export function FilterBar({
  params,
  inline,
  children,
}: {
  params: Record<string, string | undefined>;
  /** How many filters to show in the row from tablets up. */
  inline?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<"all" | "more" | null>(null);
  const active = Object.entries(params).filter(([key, value]) => value && !NOT_FILTERS.has(key)).length;
  const keepSearch = params.q ? `?q=${encodeURIComponent(params.q)}` : "";

  const items = Children.toArray(children);
  const shown = inline === undefined ? items : items.slice(0, inline);
  const more = inline === undefined ? [] : items.slice(inline);
  // Filters with a value among those behind the button (FilterSelect and DateFilter name theirs `paramKey`).
  const activeMore = more.filter((item) => {
    const key = isValidElement<{ paramKey?: string }>(item) ? item.props.paramKey : undefined;
    return key ? Boolean(params[key]) : false;
  }).length;

  const content = sheet === "more" ? more : items;

  return (
    <>
      <div className="hidden flex-wrap items-center gap-2 md:contents">
        {shown}
        {more.length > 0 ? (
          <Button variant="outline" size="icon" className="relative" onClick={() => setSheet("more")} aria-label="More filters" title="More filters">
            <SlidersHorizontal />
            {activeMore > 0 ? (
              <span className="absolute -right-1.5 -top-1.5">
                <Count value={activeMore} />
              </span>
            ) : null}
          </Button>
        ) : null}
      </div>

      <Button variant="outline" className="w-full justify-center md:hidden" onClick={() => setSheet("all")}>
        <SlidersHorizontal /> Filters
        <Count value={active} />
      </Button>
      <Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent
          side={sheet === "more" ? "right" : "bottom"}
          className={
            sheet === "more"
              ? "w-full gap-0 p-0 sm:max-w-sm"
              : "max-h-[88dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] md:hidden"
          }
        >
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>{sheet === "more" ? "More filters" : "Filters"}</SheetTitle>
            <SheetDescription>{active > 0 ? `${active} active` : "Narrow down the list."}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5 [&_label]:w-full">{content}</div>
          <div className="flex gap-2 border-t p-4">
            {active > 0 ? (
              <Link href={`${pathname}${keepSearch}`} onClick={() => setSheet(null)} className={`${buttonVariants({ variant: "outline" })} flex-1`}>
                Clear all
              </Link>
            ) : null}
            <Button className="flex-1" onClick={() => setSheet(null)}>
              Show results
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
