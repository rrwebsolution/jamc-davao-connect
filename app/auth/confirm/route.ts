import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links in Supabase emails (password reset, invitations).
 * Exchanges the one-time token for a session, then continues to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const requested = searchParams.get("next") ?? "/";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  const supabase = await createClient();
  let ok = false;

  // A bad or expired link can make these throw rather than return an error.
  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      ok = !error;
    } else if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      ok = !error;
    }
  } catch {
    ok = false;
  }

  if (!ok && code && next !== "/reset-password") {
    // A sign-up link opened on another device (or browser) cannot sign in
    // there, but Supabase has already confirmed the email address before
    // handing out the code. Say so, rather than calling the link invalid.
    return NextResponse.redirect(new URL("/login?notice=confirmed", origin));
  }
  return NextResponse.redirect(new URL(ok ? next : "/login?error=link", origin));
}
