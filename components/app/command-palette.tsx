"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarDays, Loader2, Network, Search, UserPlus, Users, UsersRound, type LucideIcon } from "lucide-react";
import { globalSearch, type SearchResults } from "@/app/(app)/actions";
import { startNavigationProgress } from "@/components/app/navigation-progress";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NAV_KEYWORDS, QUICK_ACTIONS } from "@/lib/commands";
import { NAV } from "@/lib/nav";

const RECORD_GROUPS: { key: keyof SearchResults; label: string; icon: LucideIcon }[] = [
  { key: "members", label: "Members", icon: Users },
  { key: "visitors", label: "Visitors", icon: UserPlus },
  { key: "groups", label: "Cell Groups", icon: UsersRound },
  { key: "services", label: "Services", icon: CalendarCheck },
  { key: "events", label: "Events", icon: CalendarDays },
  { key: "ministries", label: "Ministries", icon: Network },
];

const allowed = (required: string[], permissions: string[]) =>
  required.length === 0 || required.some((key) => permissions.includes(key));

/**
 * Ctrl/Cmd+K: jump to a page, start a common action, or find a record.
 * Pages and actions are filtered by the user's permissions here; the routes
 * and the database enforce the same rules again, so this is convenience only.
 */
export function CommandPalette({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, startSearch] = useTransition();
  const latest = useRef(0);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Records are searched on the server (under RLS) after a short pause.
  useEffect(() => {
    const term = query.trim();
    const requestId = ++latest.current;
    if (term.length < 2) {
      return;
    }
    const timer = setTimeout(() => {
      startSearch(async () => {
        const found = await globalSearch(term);
        if (requestId === latest.current) {
          setResults(found);
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function close() {
    setOpen(false);
    setQuery("");
    setResults(null);
  }

  /** Close first, navigate straight away; the destination shows its own skeleton. */
  function go(href: string) {
    close();
    startNavigationProgress();
    router.push(href);
  }

  const term = query.trim();
  const sections = NAV.map((section) => ({
    label: section.label ?? "Navigation",
    items: section.items.filter((item) => allowed(item.permissions, permissions)),
  })).filter((section) => section.items.length > 0);
  const actions = QUICK_ACTIONS.filter((action) => allowed(action.permissions, permissions));

  return (
    <>
      <Button
        variant="outline"
        className="hidden h-8 w-56 justify-start gap-2 border-current/15 bg-transparent px-2.5 font-normal text-current/70 hover:bg-current/5 hover:text-current md:inline-flex"
        onClick={() => {
          setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform));
          setOpen(true);
        }}
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded border border-current/20 px-1.5 text-[10px] font-medium">Ctrl K</kbd>
      </Button>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Search and commands">
        <Search />
      </Button>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent
          showCloseButton={false}
          className="top-[8%] max-w-[calc(100%-1.5rem)] translate-y-0 gap-0 overflow-hidden p-0 max-sm:top-0 max-sm:bottom-0 max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none max-sm:p-0 max-sm:pt-[env(safe-area-inset-top)] sm:top-[14%] sm:max-w-xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Command palette</DialogTitle>
            <DialogDescription>Search for a page, an action or a record.</DialogDescription>
          </DialogHeader>
          <Command loop>
            <CommandInput
              autoFocus
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                if (value.trim().length < 2) setResults(null);
              }}
              placeholder="Search or type a command…"
            />
            <button type="button" onClick={close} className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.6rem)] rounded-md px-2 py-1 text-sm text-muted-foreground sm:hidden">
              Close
            </button>
            <CommandList className="max-sm:max-h-none max-sm:flex-1">
              <CommandEmpty>{searching ? "Searching…" : `Nothing found for “${term}”.`}</CommandEmpty>

              {actions.length > 0 ? (
                <CommandGroup heading="Quick actions">
                  {actions.map((action) => (
                    <CommandItem key={action.href} value={`action ${action.title}`} keywords={action.keywords} onSelect={() => go(action.href)}>
                      <action.icon />
                      <span className="flex-1 truncate">{action.title}</span>
                      <CommandShortcut className="tracking-normal">Action</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {sections.map((section) => (
                <CommandGroup key={section.label} heading={section.label}>
                  {section.items.map((item) => (
                    <CommandItem
                      key={item.href}
                      value={`go ${item.title}`}
                      keywords={[section.label, ...(NAV_KEYWORDS[item.href] ?? [])]}
                      onSelect={() => go(item.href)}
                    >
                      <item.icon />
                      <span className="flex-1 truncate">{item.title}</span>
                      <CommandShortcut className="tracking-normal">{section.label}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}

              {results
                ? RECORD_GROUPS.filter((group) => results[group.key].length > 0).map((group) => (
                    <CommandGroup key={group.key} heading={group.label}>
                      {results[group.key].map((hit) => (
                        // The server already matched these (also on ID or phone), so the
                        // current query is added as a keyword to keep them in the list.
                        <CommandItem key={hit.href} value={`${group.key} ${hit.title} ${hit.href}`} keywords={[term]} onSelect={() => go(hit.href)}>
                          <group.icon />
                          <span className="flex-1 truncate">{hit.title}</span>
                          {hit.detail ? <CommandShortcut className="tracking-normal">{hit.detail}</CommandShortcut> : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))
                : null}

              {searching ? (
                <p className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> Searching records…
                </p>
              ) : null}
            </CommandList>
            <p className="hidden items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground sm:flex">
              <span>↑↓ to move</span>
              <span>Enter to open</span>
              <span>Esc to close</span>
              <span className="ml-auto">{isMac ? "⌘K" : "Ctrl K"} to toggle</span>
            </p>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
