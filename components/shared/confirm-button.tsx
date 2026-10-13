"use client";

import { useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/components/app/navigation-progress";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/shared/form";
import type { ActionResult } from "@/lib/types";

/**
 * A button that asks for confirmation, runs a Server Action, and reports the
 * result with a toast. Used for archive, restore, convert, delete and reset.
 */
export function ConfirmButton({
  action,
  title,
  description,
  confirmLabel,
  successMessage,
  redirectTo,
  destructive = false,
  children,
  ...buttonProps
}: {
  action: () => Promise<ActionResult<unknown>>;
  title: string;
  description: string;
  confirmLabel: string;
  successMessage: string;
  redirectTo?: string;
  destructive?: boolean;
  children: ReactNode;
} & Omit<ComponentProps<typeof Button>, "onClick">) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run() {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      setOpen(false);
      if (redirectTo) {
        startNavigationProgress();
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <PendingButton
              pending={pending}
              pendingText="Working…"
              variant={destructive ? "destructive" : "default"}
              onClick={run}
            >
              {confirmLabel}
            </PendingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
