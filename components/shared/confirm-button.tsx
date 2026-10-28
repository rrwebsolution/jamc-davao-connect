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

export type ConfirmOptions = {
  action: () => Promise<ActionResult<unknown>>;
  title: string;
  description: string;
  confirmLabel: string;
  successMessage: string;
  redirectTo?: string;
  destructive?: boolean;
};

/**
 * The confirmation itself, opened by its owner: runs the Server Action and
 * reports the result with a toast. Used by ConfirmButton and row menus.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  action,
  title,
  description,
  confirmLabel,
  successMessage,
  redirectTo,
  destructive = false,
}: ConfirmOptions & { open: boolean; onOpenChange: (open: boolean) => void }) {
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
      onOpenChange(false);
      if (redirectTo) {
        startNavigationProgress();
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <PendingButton pending={pending} pendingText="Working…" variant={destructive ? "destructive" : "default"} onClick={run}>
            {confirmLabel}
          </PendingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
}: ConfirmOptions & { children: ReactNode } & Omit<ComponentProps<typeof Button>, "onClick">) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        action={action}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        successMessage={successMessage}
        redirectTo={redirectTo}
        destructive={destructive}
      />
    </>
  );
}
