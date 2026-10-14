import "server-only";
import { headers } from "next/headers";

/**
 * The address that links in emails (sign-up confirmation, invitations,
 * password resets) point to.
 *
 * 1. NEXT_PUBLIC_SITE_URL, when set.
 * 2. On Vercel, the project's production domain (VERCEL_PROJECT_PRODUCTION_URL,
 *    set by Vercel itself), so emails sent from a preview or from someone's
 *    laptop still open the live site.
 * 3. Otherwise the address the request came in on (local development).
 *
 * Supabase only follows the link if this address is listed under
 * Authentication -> URL Configuration -> Redirect URLs.
 */
export async function siteUrl() {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const headerList = await headers();
  return headerList.get("origin") ?? `https://${headerList.get("host")}`;
}
