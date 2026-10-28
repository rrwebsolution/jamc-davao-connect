"use client";

import { Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Loader2, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CommandPalette } from "@/components/app/command-palette";
import { LabelsProvider, useLabel } from "@/components/app/labels";
import { NavigationProgress } from "@/components/app/navigation-progress";
import { AccountSheet, BottomNav } from "@/components/app/mobile-nav";
import { NotificationBell } from "@/components/app/notification-bell";
import { PageCacheProvider } from "@/components/app/page-boundary";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import type { UiLabels } from "@/lib/labels";
import { NAV, PAGE_TITLES, type NavItem } from "@/lib/nav";

export type ShellUser = {
  id: string;
  name: string;
  email: string;
  roleNames: string[];
  /** Photo of the member this login is linked to, if any (short-lived signed URL). */
  photoUrl: string | null;
};
export type ShellBrand = {
  name: string;
  shortName: string;
  /** Shown small under the name in the sidebar. */
  tagline: string;
  /** The church logo, made for the dark sidebar. */
  logoUrl: string | null;
  /** The login page's light-mode logo (dark or full colour), if one was uploaded: readable on a light header. */
  lightLogoUrl: string | null;
  logoSize: number;
};

const COLLAPSE_KEY = "jamc-sidebar-collapsed";
const COLLAPSE_EVENT = "jamc-sidebar-change";

function subscribeToCollapse(onChange: () => void) {
  window.addEventListener(COLLAPSE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    // Storage can be unavailable (private mode); the sidebar just stays expanded.
    return false;
  }
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Spinner on the clicked link while its page is on the way. */
function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 className="ml-auto size-3.5 animate-spin opacity-70" aria-hidden /> : null;
}

function NavLink({
  item,
  collapsed,
  active,
  badge,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  /** A count shown next to the item, e.g. registrations waiting for approval. */
  badge?: number;
  onNavigate: (href: string) => void;
}) {
  const Icon = item.icon;
  const title = useLabel()(item.title);
  const link = (
    <Link
      href={item.href}
      onClick={() => onNavigate(item.href)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-10 items-center gap-3 rounded-lg px-3 type-sidebar transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        collapsed && "justify-center px-0",
        active
          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      {/* A short bar marks the current page, besides the fill. */}
      {active ? <span className="absolute inset-y-2.5 left-0 w-0.5 rounded-full bg-sidebar-foreground" aria-hidden /> : null}
      <Icon className="size-[18px] shrink-0" aria-hidden />
      {collapsed ? <span className="sr-only">{title}</span> : <span className="truncate">{title}</span>}
      {badge ? (
        <span
          className={cn(
            "flex h-5 min-w-5 items-center justify-center rounded-full bg-highlight px-1.5 text-[11px] font-semibold text-highlight-foreground",
            collapsed ? "absolute right-1 top-0.5 h-4 min-w-4 px-1 text-[10px]" : "ml-auto",
          )}
          aria-label={`${badge} waiting`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      {collapsed || badge ? null : <LinkPending />}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarContent({
  brand,
  permissions,
  collapsed,
  badges,
  onNavigate,
}: {
  brand: ShellBrand;
  permissions: string[];
  collapsed: boolean;
  badges: Record<string, number>;
  onNavigate?: () => void;
}) {
  const sections = NAV.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.permissions.length === 0 || item.permissions.some((key) => permissions.includes(key)),
    ),
  })).filter((section) => section.items.length > 0);

  // Highlight the clicked item straight away, before the new route commits.
  // The pending choice only counts while we are still on the page it was made on.
  const pathname = usePathname();
  const label = useLabel();
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null);
  const target = pending && pending.from === pathname ? pending.href : pathname;

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn("flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="" style={{ height: brand.logoSize }} className="w-auto max-w-[55%] shrink-0 object-contain" />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sm font-bold">
            {brand.shortName.slice(0, 1)}
          </span>
        )}
        {collapsed ? null : (
          <span className="min-w-0 leading-tight" title={brand.name}>
            <span className="line-clamp-2 text-sm font-semibold">{brand.shortName}</span>
            {/* A logo usually carries the church's name already: the tagline is shown only without one. */}
            {brand.tagline && !brand.logoUrl ? <span className="block truncate text-xs text-sidebar-foreground/65">{brand.tagline}</span> : null}
          </span>
        )}
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
        {sections.map((section, index) => (
          <div key={section.label ?? index} className="space-y-1">
            {section.label && !collapsed ? (
              <p className="px-3 pb-1 text-xs font-medium text-sidebar-foreground/55">
                {label(section.label)}
              </p>
            ) : null}
            {section.label && collapsed ? <div className="mx-2 border-t border-sidebar-border" /> : null}
            {section.items.map((item) => (
              <NavLink
                key={item.title}
                item={item}
                collapsed={collapsed}
                active={isActive(target, item.href)}
                badge={badges[item.href]}
                onNavigate={(href) => {
                  setPending({ href, from: pathname });
                  onNavigate?.();
                }}
              />
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

// Screens reached from the tab bar or the "More" sheet: no back arrow on these.
const TOP_LEVEL = new Set([...NAV.flatMap((section) => section.items.map((item) => item.href)), "/profile"]);

function Breadcrumbs({ brand }: { brand: ShellBrand }) {
  const pathname = usePathname();
  const router = useRouter();
  const label = useLabel();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((segment) => PAGE_TITLES[segment] ?? "Details");
  const title = [...crumbs].reverse().find((crumb) => crumb !== "Details" || crumbs.length === 1) ?? "Dashboard";
  const nested = !TOP_LEVEL.has(pathname);
  const isHome = pathname === "/dashboard";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 md:hidden">
      {/* Phones: a back arrow on inner screens, like an app. */}
      {nested ? (
        <Button variant="ghost" size="icon" className="-ml-1 md:hidden" onClick={() => router.back()} aria-label="Back">
          <ArrowLeft />
        </Button>
      ) : null}
      {/* Phones, home screen: the app's own name and logo instead of "Dashboard". */}
      {isHome ? (
        <span className="flex min-w-0 items-center gap-2 md:hidden">
          {/*
            The church logo is made for the dark sidebar and would vanish on a
            light header. In light mode: the light-mode logo if there is one,
            otherwise the church logo on a small tile in the sidebar colour.
          */}
          {brand.lightLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.lightLogoUrl} alt="" className="h-7 w-auto max-w-24 shrink-0 object-contain dark:hidden" />
          ) : brand.logoUrl ? (
            <span className="flex h-8 shrink-0 items-center rounded-md bg-sidebar px-1.5 dark:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logoUrl} alt="" className="h-6 w-auto max-w-20 object-contain" />
            </span>
          ) : null}
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt="" className="hidden h-7 w-auto max-w-24 shrink-0 object-contain dark:block" />
          ) : brand.lightLogoUrl ? (
            <span className="hidden h-8 shrink-0 items-center rounded-md bg-white px-1.5 dark:flex">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.lightLogoUrl} alt="" className="h-6 w-auto max-w-20 object-contain" />
            </span>
          ) : null}
          <span className="truncate text-base font-semibold">{brand.shortName}</span>
        </span>
      ) : null}
      <div className={cn("min-w-0", isHome && "max-md:hidden")}>
      <p className="truncate text-base font-semibold md:text-base">{crumbs.at(-1) === "Details" ? `${label(title)} details` : label(title)}</p>
      {crumbs.length > 1 ? (
        <ol className="hidden items-center gap-1 text-xs opacity-70 sm:flex" aria-label="Breadcrumb">
          {crumbs.map((crumb, index) => (
            <li key={index} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
              {label(crumb)}
            </li>
          ))}
        </ol>
      ) : null}
      </div>
    </div>
  );
}

export function AppShell({
  brand,
  user,
  permissions,
  allowThemeToggle,
  labels,
  badges = {},
  children,
}: {
  brand: ShellBrand;
  user: ShellUser;
  permissions: string[];
  allowThemeToggle: boolean;
  /** Renamed menu items and page titles, from Settings → Labels. */
  labels: UiLabels;
  /** Counts to show beside navigation items, keyed by href. */
  badges?: Record<string, number>;
  children: ReactNode;
}) {
  // The server always renders the expanded sidebar; the saved choice applies after hydration.
  const collapsed = useSyncExternalStore(subscribeToCollapse, readCollapsed, () => false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function toggleCollapsed() {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1");
    } catch {
      // See readCollapsed.
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }

  return (
    <LabelsProvider labels={labels}>
    <div className="flex min-h-dvh w-full">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 border-r border-sidebar-border transition-[width] duration-200 lg:block print:hidden",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <SidebarContent brand={brand} permissions={permissions} collapsed={collapsed} badges={badges} />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-72 gap-0 border-sidebar-border p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>{brand.name}</SheetTitle>
            <SheetDescription>Main navigation</SheetDescription>
          </SheetHeader>
          <SidebarContent
            brand={brand}
            permissions={permissions}
            collapsed={false}
            badges={badges}
            onNavigate={() => setDrawerOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b bg-navbar px-3 pt-[env(safe-area-inset-top)] text-navbar-foreground sm:px-5 md:h-16 lg:px-6 print:hidden">
          {/* Tablets keep the slide-in menu; phones use the tab bar at the bottom instead. */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <Breadcrumbs brand={brand} />
          <div className="min-w-0 md:flex-1">
            <CommandPalette permissions={permissions} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <span className="hidden items-center gap-1 md:flex">
              {allowThemeToggle ? <ThemeToggle /> : null}
              <UserMenu user={user} />
            </span>
            <span className="md:hidden">
              <AccountSheet user={user} allowThemeToggle={allowThemeToggle} />
            </span>
          </div>
        </header>
        {/* On phones the content clears the tab bar and the home indicator. */}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:p-5 sm:pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-6 lg:p-6">
          <PageCacheProvider userId={user.id}>{children}</PageCacheProvider>
        </main>
      </div>
      <BottomNav permissions={permissions} badges={badges} />
    </div>
    </LabelsProvider>
  );
}
