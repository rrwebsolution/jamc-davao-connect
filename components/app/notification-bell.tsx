"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import {
  Bell,
  Cake,
  CalendarDays,
  CalendarX,
  Check,
  HandHeart,
  HeartHandshake,
  Loader2,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { loadNotifications, markNotificationsRead, type NotificationItem } from "@/app/(app)/module-actions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

function timeAgo(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const KIND_ICONS: [prefix: string, icon: LucideIcon][] = [
  ["follow_up", HeartHandshake],
  ["visitor", UserPlus],
  ["absence", CalendarX],
  ["birthday", Cake],
  ["event", CalendarDays],
  ["care", HandHeart],
  ["account", UserCheck],
  ["approval", UserCheck],
];

function iconFor(kind: string) {
  return KIND_ICONS.find(([prefix]) => kind.startsWith(prefix))?.[1] ?? Bell;
}

/** Popover from tablets up; a sheet from the side on phones. */
const isWide = () => window.matchMedia("(min-width: 768px)").matches;

/** Bell with the unread count; opens the list, where items link to their record. */
export function NotificationBell() {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      const result = await loadNotifications();
      setItems(result.items);
      setUnread(result.unread);
      setLoaded(true);
    });
  }, []);

  // Loaded shortly after the app opens and then every two minutes, never as
  // part of a route change, so navigating does not wait on it.
  useEffect(() => {
    const first = setTimeout(refresh, 1500);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 120_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  function markRead(id?: string) {
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => (!id || item.id === id ? { ...item, read_at: item.read_at ?? now } : item)));
    setUnread((current) => (id ? Math.max(0, current - 1) : 0));
    startTransition(async () => {
      await markNotificationsRead(id);
    });
  }

  function close() {
    setPopoverOpen(false);
    setSheetOpen(false);
  }

  const list = (
    <NotificationList items={items} loading={!loaded && pending} onRead={markRead} onNavigate={close} />
  );

  return (
    <>
      <Popover.Root
        open={popoverOpen}
        onOpenChange={(next) => {
          if (next) refresh();
          if (next && !isWide()) {
            setSheetOpen(true);
            return;
          }
          setPopoverOpen(next);
        }}
      >
        <Popover.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            />
          }
        >
          <Bell />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-navbar">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} className="isolate z-50 outline-none">
            <Popover.Popup
              className={cn(
                "flex max-h-[min(32rem,var(--available-height))] w-96 max-w-[calc(100vw-2rem)] origin-(--transform-origin) flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none duration-150",
                "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              )}
            >
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div className="min-w-0">
                  <Popover.Title className="text-sm font-semibold">Notifications</Popover.Title>
                  <Popover.Description className="text-xs text-muted-foreground">
                    {unread > 0 ? `${unread} unread` : "You're all caught up."}
                  </Popover.Description>
                </div>
                {unread > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => markRead()}>
                    <Check /> Mark all as read
                  </Button>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-sm">
          <SheetHeader className="border-b p-4">
            <SheetTitle>Notifications</SheetTitle>
            <SheetDescription>{unread > 0 ? `${unread} unread` : "You're all caught up."}</SheetDescription>
            {unread > 0 ? (
              <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => markRead()}>
                <Check /> Mark all as read
              </Button>
            ) : null}
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">{list}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function NotificationList({
  items,
  loading,
  onRead,
  onNavigate,
}: {
  items: NotificationItem[];
  loading: boolean;
  onRead: (id: string) => void;
  onNavigate: () => void;
}) {
  if (loading) {
    return (
      <p className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Bell className="size-5" aria-hidden />
        </span>
        <p className="text-sm font-medium">No notifications yet</p>
        <p className="text-xs text-muted-foreground">Follow-ups, approvals and reminders will show here.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {items.map((item) => {
        const Icon = iconFor(item.kind);
        const unread = !item.read_at;
        const body = (
          <span className="flex items-start gap-3">
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", unread ? "bg-accent text-primary" : "bg-muted text-muted-foreground")}>
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm", unread && "font-medium")}>{item.title}</span>
              {item.body ? <span className="block line-clamp-2 text-xs text-muted-foreground">{item.body}</span> : null}
              <span className="mt-0.5 block text-xs text-muted-foreground">{timeAgo(item.created_at)}</span>
            </span>
          </span>
        );
        return (
          <li key={item.id} className={cn("group relative flex items-start", unread && "bg-accent/40")}>
            {item.link ? (
              <Link
                href={item.link}
                className="block min-w-0 flex-1 px-4 py-3 outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                  if (unread) onRead(item.id);
                  onNavigate();
                }}
              >
                {body}
              </Link>
            ) : (
              <div className="min-w-0 flex-1 px-4 py-3">{body}</div>
            )}
            {unread ? (
              <button
                type="button"
                onClick={() => onRead(item.id)}
                className="mr-2 mt-3 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:size-10"
                aria-label={`Mark “${item.title}” as read`}
                title="Mark as read"
              >
                <span className="size-2 rounded-full bg-highlight group-hover:hidden" aria-hidden />
                <Check className="hidden size-4 group-hover:block" aria-hidden />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
