import type { CSSProperties } from "react";
import type { Metadata, Viewport } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { brandingAssetUrl, getBranding } from "@/lib/branding";
import { fontVariables } from "@/lib/fonts";
import { motionLevel, REVEAL_SCRIPT, scrollRevealOn } from "@/lib/motion";
import { brandVariables } from "@/lib/theme";
import { typographyVariables } from "@/lib/typography";
import "./globals.css";


export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  const favicon = brandingAssetUrl(branding.favicon_path);
  return {
    title: { default: branding.system_name, template: `%s · ${branding.system_short_name}` },
    description: `${branding.church_name} — ${branding.tagline}`,
    // Without a favicon the generated app icon is used, so a home-screen shortcut always has one.
    icons: { icon: favicon ?? "/pwa-icon/192", apple: "/pwa-icon/180" },
    appleWebApp: { capable: true, title: branding.system_short_name, statusBarStyle: "default" },
    formatDetection: { telephone: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await getBranding();
  return {
    width: "device-width",
    initialScale: 1,
    // Lets the layout extend under notches and the home indicator; the shell pads for them.
    viewportFit: "cover",
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: branding.navbar_color },
      { media: "(prefers-color-scheme: dark)", color: "#1c1917" },
    ],
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const branding = await getBranding();

  return (
    <html
      lang="en"
      className={`${fontVariables} h-full antialiased`}
      style={{ ...brandVariables(branding), ...typographyVariables(branding) } as CSSProperties}
      data-motion={motionLevel(branding)}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Scroll reveal: one small observer for the whole app (see lib/motion.ts). */}
        {scrollRevealOn(branding) ? <script dangerouslySetInnerHTML={{ __html: REVEAL_SCRIPT }} /> : null}
        <ThemeProvider
          defaultTheme={branding.default_theme}
          allowOverride={branding.allow_user_theme_override}
        >
          {children}
          <Toaster position="top-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
