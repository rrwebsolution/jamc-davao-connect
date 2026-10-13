"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";
import type { ThemeMode } from "@/lib/theme";

/**
 * Light / dark / system. When the Super Admin turns off per-user overrides,
 * a separate storage key is used that nothing writes to, so everyone gets the
 * system default regardless of an earlier personal choice.
 */
export function ThemeProvider({
  defaultTheme,
  allowOverride,
  children,
}: {
  defaultTheme: ThemeMode;
  allowOverride: boolean;
  children: ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={defaultTheme}
      enableSystem
      disableTransitionOnChange
      storageKey={allowOverride ? "jamc-theme" : "jamc-theme-default"}
    >
      {children}
    </NextThemesProvider>
  );
}
