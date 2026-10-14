import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/** Label + control + validation message. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="motion-message text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Every dropdown in the app. It takes the same props and <option> children as
 * a native <select> (so register() and value/onChange work as before) but
 * opens as a searchable command list. See command-select.tsx.
 */
export { CommandSelect as NativeSelect } from "@/components/shared/command-select";

/** Button that shows a spinner and blocks double submission while pending. */
export function PendingButton({
  pending,
  pendingText,
  children,
  disabled,
  ...props
}: ComponentProps<typeof Button> & { pending: boolean; pendingText?: string }) {
  return (
    <Button disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs sm:p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
