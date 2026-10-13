"use client";

import { useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldValues, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { saveSession } from "@/app/(app)/attendance/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { startNavigationProgress } from "@/components/app/navigation-progress";
import { Field, NativeSelect, PendingButton } from "@/components/shared/form";
import type { AttendanceSession, Lookup } from "@/lib/types";
import { sessionSchema } from "@/lib/validation";

/** Create or edit an attendance session: service/event, date, optional cell group. */
export function SessionDialog({
  session,
  types,
  groups,
  groupRequired,
  today,
  trigger,
  defaultOpen = false,
  ...buttonProps
}: {
  session?: AttendanceSession;
  types: Lookup[];
  groups: { id: string; name: string }[];
  /** Cell leaders may only create sessions for a group they lead. */
  groupRequired: boolean;
  today: string;
  trigger: ReactNode;
  /** Start open (used by the command palette's "Record Attendance" via ?new=1). */
  defaultOpen?: boolean;
} & Omit<React.ComponentProps<typeof Button>, "onClick" | "children">) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(defaultOpen);
  const close = () => {
    setOpen(false);
    if (defaultOpen && window.location.search.includes("new=1")) {
      window.history.replaceState(null, "", pathname);
    }
  };
  const [pending, startTransition] = useTransition();
  const form = useForm<FieldValues>({
    resolver: zodResolver(sessionSchema) as unknown as Resolver<FieldValues>,
    defaultValues: {
      attendance_type_id: session?.attendance_type_id ?? types[0]?.id ?? "",
      title: session?.title ?? types[0]?.name ?? "",
      session_date: session?.session_date ?? today,
      cell_group_id: session?.cell_group_id ?? (groupRequired ? (groups[0]?.id ?? "") : ""),
      notes: session?.notes ?? "",
    },
  });
  const { register, formState } = form;
  const error = (name: string) => formState.errors[name]?.message as string | undefined;

  const onSubmit = form.handleSubmit(() => {
    const values = form.getValues();
    if (groupRequired && !values.cell_group_id) {
      form.setError("cell_group_id", { message: "Choose the cell group this session is for" });
      return;
    }
    // An empty title falls back to the type's name, e.g. "Sunday Service".
    startTransition(async () => {
      const result = await saveSession(session?.id ?? null, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(session ? "Session updated" : "Session created");
      close();
      if (session) {
        router.refresh();
      } else {
        startNavigationProgress();
        router.push(`/attendance/services/${result.data!.id}`);
      }
    });
  });

  return (
    <>
      <Button
        {...buttonProps}
        onClick={() => {
          if (!session) {
            const type = types.find((item) => item.id === form.getValues("attendance_type_id"));
            if (!form.getValues("title") && type) form.setValue("title", type.name);
          }
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && (next ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{session ? "Edit session" : "New attendance session"}</DialogTitle>
            <DialogDescription>
              {session ? "Update the details of this session." : "Choose the service or event and its date, then record attendance."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Service / event type" htmlFor="attendance_type_id" required error={error("attendance_type_id")}>
              <NativeSelect
                id="attendance_type_id"
                {...register("attendance_type_id", {
                  onChange: (event) => {
                    const previous = types.map((type) => type.name);
                    const current = form.getValues("title");
                    // Keep the title in step with the type unless the user typed their own.
                    if (!current || previous.includes(current)) {
                      form.setValue("title", types.find((type) => type.id === event.target.value)?.name ?? "");
                    }
                  },
                })}
              >
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Name" htmlFor="title" required error={error("title")}>
              <Input id="title" placeholder="e.g. Sunday Service" {...register("title")} />
            </Field>
            <Field label="Date" htmlFor="session_date" required error={error("session_date")}>
              <Input id="session_date" type="date" {...register("session_date")} />
            </Field>
            {groups.length > 0 ? (
              <Field
                label="Cell group"
                htmlFor="cell_group_id"
                required={groupRequired}
                error={error("cell_group_id")}
                hint="For a cell meeting. Only that group's members are listed."
              >
                <NativeSelect id="cell_group_id" {...register("cell_group_id")}>
                  {groupRequired ? null : <option value="">Whole church</option>}
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field label="Notes" htmlFor="notes" error={error("notes")}>
              <Textarea id="notes" rows={2} {...register("notes")} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <PendingButton type="submit" pending={pending} pendingText="Saving…">
                {session ? "Save changes" : "Create session"}
              </PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
