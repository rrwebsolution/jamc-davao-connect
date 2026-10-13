import type { MetadataRoute } from "next";
import { getBranding } from "@/lib/branding";

/**
 * Web App Manifest, built from Appearance & Branding settings, so the installed
 * app carries the church's own name and colours.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getBranding();

  return {
    name: branding.system_name,
    short_name: branding.system_short_name,
    description: `${branding.church_name} — ${branding.tagline}`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: branding.background_color,
    theme_color: branding.sidebar_background_color,
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
