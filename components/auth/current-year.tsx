"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * The current year, read in the browser. The login page itself is prerendered,
 * so a year computed on the server would be frozen at build time.
 */
export function CurrentYear() {
  const year = useSyncExternalStore(
    noop,
    () => String(new Date().getFullYear()),
    () => "",
  );
  return <span suppressHydrationWarning>{year}</span>;
}
