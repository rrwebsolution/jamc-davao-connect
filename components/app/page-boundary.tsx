"use client";

import { createContext, Suspense, use, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { holdNavigationProgress } from "@/components/app/navigation-progress";

/**
 * Whose pages are being remembered. Part of every cache key, so one user's
 * pages can never be shown to the next person who signs in on the same tab.
 */
const PageCacheScope = createContext<string>("");

export function PageCacheProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <PageCacheScope value={userId}>{children}</PageCacheScope>;
}

// The last rendered content of each visited page, kept in memory for this tab.
const MAX_PAGES = 40;
const visited = new Map<string, ReactNode>();

/** Forget everything, e.g. when signing out. */
export function clearPageCache() {
  visited.clear();
}

function remember(key: string, content: ReactNode) {
  visited.delete(key);
  visited.set(key, content);
  // Oldest first out.
  for (const oldest of visited.keys()) {
    if (visited.size <= MAX_PAGES) break;
    visited.delete(oldest);
  }
}

/** Runs only once the page's content has actually arrived and been shown. */
function Remember({ cacheKey, content }: { cacheKey: string; content: ReactNode }) {
  useEffect(() => {
    remember(cacheKey, content);
  }, [cacheKey, content]);
  return null;
}

/** Keeps the top progress bar running while data is on its way, first visit or not. */
function Refreshing() {
  useEffect(() => holdNavigationProgress(), []);
  return null;
}

/**
 * Wraps a page's content. The first visit shows the skeleton while data
 * loads. Later visits show what the page looked like last time straight
 * away, with only the progress bar at the top while the latest data is
 * fetched; it then replaces the old content in place.
 */
export function PageBoundary({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  const userId = use(PageCacheScope);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // A page instance belongs to the path it was created for. If the router has
  // already moved on while this instance is still around, it must neither read
  // nor write the cache, or one page's content could be filed under another's URL.
  const [ownPath] = useState(pathname);
  const enabled = Boolean(userId) && pathname === ownPath;
  const key = `${userId}|${pathname}?${search}`;
  const previous = enabled ? visited.get(key) : undefined;

  return (
    <Suspense
      fallback={
        previous ? (
          <div aria-busy="true">
            <Refreshing />
            {previous}
          </div>
        ) : (
          <>
            <Refreshing />
            {fallback}
          </>
        )
      }
    >
      {children}
      {enabled ? <Remember cacheKey={key} content={children} /> : null}
    </Suspense>
  );
}
