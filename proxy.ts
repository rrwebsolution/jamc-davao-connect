import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Supabase sends people back to the Site URL itself ("/?code=...") when the
  // address the app asked for is not on its Redirect URLs list. Finish the
  // sign-in there anyway instead of dropping the code.
  const { pathname, searchParams } = request.nextUrl;
  if (searchParams.has("code") && !pathname.startsWith("/auth/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/confirm";
    url.search = "";
    url.searchParams.set("code", searchParams.get("code")!);
    url.searchParams.set("next", "/");
    return NextResponse.redirect(url);
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
