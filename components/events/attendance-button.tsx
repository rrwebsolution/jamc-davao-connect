"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/components/app/navigation-progress";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { openEventAttendance } from "@/app/(app)/module-actions";
import { PendingButton } from "@/components/shared/form";

/** Opens the event's attendance sheet, creating it the first time. */
export function EventAttendanceButton({ eventId, hasSession }: { eventId: string; hasSession: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <PendingButton
      pending={pending}
      pendingText="Opening…"
      onClick={() =>
        startTransition(async () => {
          const result = await openEventAttendance(eventId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          startNavigationProgress();
          router.push(`/attendance/services/${result.data!.id}`);
        })
      }
    >
      <ClipboardCheck /> {hasSession ? "Open attendance" : "Record attendance"}
    </PendingButton>
  );
}
