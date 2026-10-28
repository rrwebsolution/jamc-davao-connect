"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Eye,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog, type ConfirmOptions } from "@/components/shared/confirm-button";

// Icons are named rather than passed, so server pages can describe the menu.
const ICONS = {
  view: Eye,
  edit: Pencil,
  archive: Archive,
  restore: ArchiveRestore,
  delete: Trash2,
  account: UserPlus,
} satisfies Record<string, LucideIcon>;

export type RowMenuItem = {
  label: string;
  icon?: keyof typeof ICONS;
  /** A link… */
  href?: string;
  /** …or an action that is confirmed first. */
  confirm?: ConfirmOptions;
  /** Starts a new group, with a separator above it. */
  separated?: boolean;
};

/**
 * The "⋯" menu at the end of a row or card: one control instead of a row of
 * buttons. Confirmations open after the menu has closed.
 */
export function RowMenu({
  label,
  items,
  text,
}: {
  label: string;
  items: RowMenuItem[];
  /** Show a "More ▾" style button with this text instead of the "⋯" icon. */
  text?: string;
}) {
  const [confirming, setConfirming] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={
            text
              ? buttonVariants({ variant: "outline", className: "data-popup-open:bg-muted" })
              : buttonVariants({ variant: "ghost", size: "icon-sm", className: "text-muted-foreground data-popup-open:bg-muted" })
          }
          aria-label={text ? undefined : label}
        >
          {text ? (
            <>
              {text} <ChevronDown />
            </>
          ) : (
            <MoreHorizontal />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {items.map((item, index) => {
            const Icon = item.icon ? ICONS[item.icon] : null;
            const destructive = Boolean(item.confirm?.destructive);
            return (
              <Fragment key={item.label}>
                {item.separated && index > 0 ? <DropdownMenuSeparator /> : null}
                {item.href ? (
                  <DropdownMenuItem render={<Link href={item.href} />}>
                    {Icon ? <Icon /> : null} {item.label}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    variant={destructive ? "destructive" : "default"}
                    onClick={() => {
                      if (!item.confirm) return;
                      setConfirming(item.confirm);
                      setOpen(true);
                    }}
                  >
                    {Icon ? <Icon /> : null} {item.label}
                  </DropdownMenuItem>
                )}
              </Fragment>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming ? <ConfirmDialog {...confirming} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
