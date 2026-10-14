"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  CalendarCheck,
  ChevronRight,
  HeartHandshake,
  Home,
  KeyRound,
  Loader2,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Sun,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { signOut } from "@/app/(app)/actions";
import { clearPageCache } from "@/components/app/page-boundary";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PersonAvatar } from "@/components/shared/person-avatar";
import type { ShellUser } from "@/components/app/app-shell";
import { NAV } from "@/lib/nav";

const has = (required: string[], permissions: string[]) =>
  required.length === 0 || required.some((key) => permissions.includes(key));

type Tab = { label: string; href: string; icon: LucideIcon; match: string };

/** The four primary tabs a user may open, in a fixed order. "More" is added by the bar. */
function tabsFor(permissions: string[]): Tab[] {
  const allowed = (href: string) => {
    const item = NAV.flatMap((section) => section.items).find((entry) => entry.href === href);
    return Boolean(item && has(item.permissions, permissions));
  };
  const tabs: Tab[] = [];
  tabs.push(
    allowed("/dashboard")
      ? { label: "Home", href: "/dashboard", icon: Home, match: "/dashboard" }
      : { label: "Home", href: "/profile", icon: Home, match: "/profile" },
  );
  if (allowed("/people/members")) tabs.push({ label: "People", href: "/people/members", icon: Users, match: "/people" });
  else if (allowed("/people/visitors")) tabs.push({ label: "People", href: "/people/visitors", icon: Users, match: "/people" });
  if (allowed("/attendance/services")) tabs.push({ label: "Attendance", href: "/attendance/services", icon: CalendarCheck, match: "/attendance" });
  if (allowed("/care/follow-ups")) tabs.push({ label: "Care", href: "/care/follow-ups", icon: HeartHandshake, match: "/care" });
  return tabs;
}

const sheetClass = "max-h-[88dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]";

function SheetRow({ href, icon: Icon, children, onClick }: { href: string; icon: LucideIcon; children: ReactNode; onClick: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="flex min-h-12 items-center gap-3 px-5 py-2.5 text-[15px] active:bg-accent">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 truncate">{children}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** Phone navigation: a fixed tab bar, with everything else behind "More". */
export function BottomNav({ permissions, badges = {} }: { permissions: string[]; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  const tabs = tabsFor(permissions);

  // The tapped tab lights up at once, before the page arrives.
  const current = pending && pending.from === pathname ? pending.href : pathname;
  const activeTab = tabs.find((tab) => current === tab.match || current.startsWith(`${tab.match}/`));
  const sections = NAV.map((section) => ({
    label: section.label,
    items: section.items.filter((item) => has(item.permissions, permissions)),
  })).filter((section) => section.items.length > 0);

  const moreCount = Object.values(badges).reduce((sum, value) => sum + value, 0);

  const tabClass = (active: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none transition-colors",
      active ? "text-primary" : "text-muted-foreground active:text-foreground",
    );

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
      >
        {tabs.map((tab) => {
          const active = !moreOpen && activeTab?.href === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              onClick={() => setPending({ href: tab.match, from: pathname })}
              className={tabClass(active)}
            >
              <span className={cn("flex h-7 w-14 items-center justify-center rounded-full transition-colors", active && "bg-primary/12")}>
                <tab.icon className={cn("size-5 transition-transform duration-200", active && "scale-110")} aria-hidden />
              </span>
              {tab.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className={tabClass(moreOpen || !activeTab)}>
          <span className={cn("relative flex h-7 w-14 items-center justify-center rounded-full transition-colors", (moreOpen || !activeTab) && "bg-primary/12")}>
            <Menu className="size-5" aria-hidden />
            {moreCount > 0 ? <span className="absolute right-2 top-0.5 size-2 rounded-full bg-highlight" aria-label={`${moreCount} waiting`} /> : null}
          </span>
          More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className={sheetClass}>
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>All modules</SheetTitle>
            <SheetDescription className="sr-only">Everything you have access to</SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto py-2">
            {sections.map((section, index) => (
              <div key={section.label ?? index}>
                {section.label ? (
                  <p className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{section.label}</p>
                ) : null}
                {section.items.map((item) => (
                  <SheetRow key={item.href} href={item.href} icon={item.icon} onClick={() => setMoreOpen(false)}>
                    {item.title}
                    {badges[item.href] ? (
                      <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-highlight px-1.5 text-[11px] font-semibold text-highlight-foreground">
                        {badges[item.href]}
                      </span>
                    ) : null}
                  </SheetRow>
                ))}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Phone account menu: opened from the avatar in the header. */
export function AccountSheet({ user, allowThemeToggle }: { user: ShellUser; allowThemeToggle: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { theme, setTheme } = useTheme();
  const modes = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Account menu"
        aria-haspopup="dialog"
        className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <PersonAvatar name={user.name} className="size-8" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className={sheetClass}>
          <SheetHeader className="flex-row items-center gap-3 border-b px-5 py-4">
            <PersonAvatar name={user.name} className="size-11" />
            <div className="min-w-0 text-left">
              <SheetTitle className="truncate">{user.name}</SheetTitle>
              <SheetDescription className="truncate">{user.roleNames.join(", ") || user.email}</SheetDescription>
            </div>
          </SheetHeader>
          <div className="py-2">
            <SheetRow href="/profile" icon={UserRound} onClick={() => setOpen(false)}>
              Profile
            </SheetRow>
            <SheetRow href="/profile#change-password" icon={KeyRound} onClick={() => setOpen(false)}>
              Change password
            </SheetRow>
            {allowThemeToggle ? (
              <div className="px-5 py-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Theme</p>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
                  {modes.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      role="radio"
                      aria-checked={theme === mode.value}
                      onClick={() => setTheme(mode.value)}
                      className={cn(
                        "flex min-h-11 items-center justify-center gap-2 rounded-lg border text-sm outline-none transition-colors",
                        theme === mode.value ? "border-primary bg-primary/10 font-medium" : "active:bg-accent",
                      )}
                    >
                      <mode.icon className="size-4" aria-hidden /> {mode.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                clearPageCache();
                startTransition(() => signOut());
              }}
              className="flex min-h-12 w-full items-center gap-3 px-5 py-2.5 text-left text-[15px] text-destructive active:bg-accent"
            >
              {pending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <LogOut className="size-5" aria-hidden />}
              Log out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
