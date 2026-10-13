"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { PendingButton } from "@/components/shared/form";

/** Re-runs the page's data loading without leaving the page. */
export function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <PendingButton variant="outline" pending={pending} pendingText="Retrying…" onClick={() => startTransition(() => router.refresh())}>
      <RotateCw /> Retry
    </PendingButton>
  );
}
