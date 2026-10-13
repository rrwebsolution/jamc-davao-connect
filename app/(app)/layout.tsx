import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { SetupNotice } from "@/components/app/setup-notice";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAccess } from "@/lib/auth/session";
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

  return (
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
    >
      {children}
    </AppShell>
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
