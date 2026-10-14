import { Suspense, type CSSProperties, type ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { SetupNotice } from "@/components/app/setup-notice";
import { SystemBackground } from "@/components/app/system-background";
import { Skeleton } from "@/components/ui/skeleton";
import { can, P } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { backgroundActive, surfaceVariables } from "@/lib/background";
import { createClient } from "@/lib/supabase/server";
import { brandingAssetUrl, getBranding } from "@/lib/branding";
import { isSupabaseConfigured } from "@/lib/env";

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh w-full">
      <div className="hidden w-64 shrink-0 bg-sidebar lg:block" />
      <div className="flex-1">
        <div className="h-14 border-b bg-navbar" />
        <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}

// Reads the session, so it renders behind the Suspense boundary below.
async function AuthenticatedShell({ children }: { children: ReactNode }) {
  const [access, branding] = await Promise.all([requireAccess(), getBranding()]);

  // Shown as a badge beside "Account Approvals". Counted only for people who can act on it.
  let pendingApprovals = 0;
  if (can(access, P.usersManage)) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "pending")
      .eq("registration_source", "self_signup");
    pendingApprovals = count ?? 0;
  }

  // The system background (not the login one). It lives here, outside the
  // pages, so it stays mounted and does not flicker while they change.
  const background = backgroundActive(branding) ? brandingAssetUrl(branding.system_background_path) : null;

  return (
    <div
      className="contents"
      data-system-bg={background ? "on" : undefined}
      data-card-style={background ? branding.card_background_style : undefined}
      style={background ? (surfaceVariables(branding) as CSSProperties) : undefined}
    >
      {background ? <SystemBackground imageUrl={background} settings={branding} /> : null}
      <AppShell
      brand={{
        name: branding.system_name,
        shortName: branding.system_short_name,
        logoUrl: brandingAssetUrl(branding.logo_path),
        logoSize: branding.logo_size,
      }}
      user={{
        id: access.userId,
        name: access.fullName,
        email: access.email,
        roleNames: access.roles.map((role) => role.name),
      }}
      permissions={access.permissions}
      allowThemeToggle={branding.allow_user_theme_override}
      badges={pendingApprovals > 0 ? { "/admin/approvals": pendingApprovals } : {}}
    >
      {children}
    </AppShell>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  if (!isSupabaseConfigured) {
    return <SetupNotice />;
  }

  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
