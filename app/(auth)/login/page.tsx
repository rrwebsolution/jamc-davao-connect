import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/auth-forms";
import { Skeleton } from "@/components/ui/skeleton";
import { getBranding } from "@/lib/branding";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const branding = await getBranding();
  return (
    <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
      <LoginForm systemName={branding.system_name} />
    </Suspense>
  );
}