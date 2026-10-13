import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SetupNotice } from "@/components/app/setup-notice";
import { homePathFor } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";

async function GoHome() {
  const access = await requireAccess();
  redirect(homePathFor(access));
  return null;
}

export default function RootPage() {
  if (!isSupabaseConfigured) {
    return <SetupNotice />;
  }
  return (
    <Suspense fallback={null}>
      <GoHome />
    </Suspense>
  );
}
