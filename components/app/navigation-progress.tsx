"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// A tiny store instead of component state, so anything (a link click, a
// router.push after saving a form, the command palette) can start the bar.
let active = false;
let holds = 0;
let safety: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Call right before a programmatic navigation (router.push / router.replace). */
export function startNavigationProgress() {
  active = true;
  if (safety) clearTimeout(safety);
  // Never leave the bar running if a navigation is cancelled or fails.
  safety = setTimeout(finishNavigationProgress, 10_000);
  emit();
}

function finishNavigationProgress() {
  if (safety) clearTimeout(safety);
  safety = null;
  if (active) {
    active = false;
    emit();
  }
}

/**
 * Keeps the bar running until the returned function is called. Used while a
 * page that is showing its previous content waits for fresh data.
 */
export function holdNavigationProgress() {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Thin bar at the top of the window while a route change is on its way.
 * It only becomes visible if the change takes longer than a moment, so
 * instant navigations don't flash.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const running = useSyncExternalStore(subscribe, () => active || holds > 0, () => false);

  // The new route has committed: done.
  useEffect(() => {
    finishNavigationProgress();
  }, [pathname, search]);

  // Start on any click on an internal link, wherever it is in the app.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }
      const url = new URL(anchor.href, window.location.href);
      const samePage = url.pathname === window.location.pathname && url.search === window.location.search;
      if (url.origin !== window.location.origin || samePage) {
        return;
      }
      startNavigationProgress();
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 print:hidden" aria-hidden>
      <div className={running ? "navigation-progress-bar h-full bg-highlight" : "h-full w-full bg-highlight opacity-0 transition-opacity duration-300"} />
    </div>
  );
}
