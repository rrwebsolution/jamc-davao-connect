"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, Loader2 } from "lucide-react";
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

/** Bell with the unread count; opens the list, where items link to their record. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
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

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => {
          setOpen(true);
          refresh();
        }}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-sm">
          <SheetHeader className="border-b p-4">
            <SheetTitle>Notifications</SheetTitle>
            <SheetDescription>{unread > 0 ? `${unread} unread` : "You're all caught up."}</SheetDescription>
            {unread > 0 ? (
              <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => markRead()}>
                Mark all as read
              </Button>
            ) : null}
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {!loaded && pending ? (
              <p className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
              </p>
            ) : items.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              <ul className="divide-y">
                {items.map((item) => {
                  const body = (
                    <>
                      <span className="flex items-start gap-2">
                        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.read_at ? "bg-transparent" : "bg-highlight"}`} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm ${item.read_at ? "" : "font-medium"}`}>{item.title}</span>
                          {item.body ? <span className="block truncate text-xs text-muted-foreground">{item.body}</span> : null}
                          <span className="block text-xs text-muted-foreground">{timeAgo(item.created_at)}</span>
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {item.link ? (
                        <Link
                          href={item.link}
                          className="block p-3 hover:bg-accent"
                          onClick={() => {
                            if (!item.read_at) markRead(item.id);
                            setOpen(false);
                          }}
                        >
                          {body}
                        </Link>
                      ) : (
                        <button type="button" className="block w-full p-3 text-left hover:bg-accent" onClick={() => !item.read_at && markRead(item.id)}>
                          {body}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
