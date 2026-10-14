"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { CircleAlert, CircleCheck, Eye, EyeOff } from "lucide-react";
import type { z } from "zod";
import { requestPasswordReset, signIn, signUp, updatePassword } from "@/app/(auth)/actions";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, PendingButton } from "@/components/shared/form";
import { Textarea } from "@/components/ui/textarea";
import { forgotPasswordSchema, loginSchema, passwordSchema, signUpSchema } from "@/lib/validation";

function ErrorBanner({ message }: { message: string | null }) {
  return message ? (
    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
      {message}
    </p>
  ) : null;
}

const REMEMBERED_EMAIL = "jamc-login-email";
const FIELD = "h-11 rounded-lg text-base sm:text-sm";

export function AuthHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-7">
      <h2 data-type="page-title" className="tracking-tight">{title}</h2>
      {children ? <p className="mt-1.5 text-sm text-muted-foreground">{children}</p> : null}
    </div>
  );
}

export function LoginForm({ systemName }: { systemName: string }) {
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "link" ? "That link is invalid or has expired. Please request a new one." : null,
  );
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors } = form.formState;

  // Bring back the email this browser was asked to remember. Only the address
  // is kept, never the password, and it has no effect on the session.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBERED_EMAIL);
      if (saved && !form.getValues("email")) {
        form.setValue("email", saved);
        form.setFocus("password");
      }
    } catch {
      // Storage unavailable: nothing to restore.
    }
  }, [form]);

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    try {
      if (remember) window.localStorage.setItem(REMEMBERED_EMAIL, values.email);
      else window.localStorage.removeItem(REMEMBERED_EMAIL);
    } catch {
      // Storage unavailable: sign in still works.
    }
    startTransition(async () => {
      // On success the action redirects to the user's home, so a result only
      // comes back on failure. The button stays in its loading state meanwhile.
      const result = await signIn(values, searchParams.get("next") ?? undefined);
      if (result && !result.ok) {
        setError(result.error);
        form.setFocus("password");
      }
    });
  });

  return (
    <>
      <AuthHeading title="Welcome back">Sign in to continue to {systemName}.</AuthHeading>
      <form onSubmit={onSubmit} className="space-y-5" noValidate aria-busy={pending}>
        {error ? (
          <div className="flex gap-2.5 rounded-lg border border-destructive/25 bg-destructive/8 px-3.5 py-3 text-sm text-destructive" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        ) : null}

        <Field label="Email Address" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@example.com"
            aria-invalid={Boolean(errors.email)}
            disabled={pending}
            className={FIELD}
            {...form.register("email")}
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              disabled={pending}
              className={`${FIELD} pr-11`}
              {...form.register("password")}
            />
            <button
              type="button"
              // Keep focus and the caret in the field while toggling.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(Boolean(checked))} disabled={pending} />
            Remember my email
          </label>
          <Link href="/forgot-password" className="font-medium text-link underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        </div>

        <PendingButton type="submit" pending={pending} pendingText="Signing in…" className="h-11 w-full rounded-lg text-base sm:text-sm">
          Sign In
        </PendingButton>
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className="font-medium text-link underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </>
  );
}

export function SignUpForm({ systemName }: { systemName: string }) {
  const [pending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema) as never,
    defaultValues: {
      first_name: "", middle_name: "", last_name: "", email: "", mobile_number: "",
      password: "", confirm: "", is_existing_member: false, member_hint: "",
    },
  });
  const { errors } = form.formState;
  const isMember = useWatch({ control: form.control, name: "is_existing_member" });

  const onSubmit = form.handleSubmit(() => {
    setError(null);
    startTransition(async () => {
      // On success the action redirects to the confirmation page.
      const result = await signUp(form.getValues());
      if (result && !result.ok) setError(result.error);
    });
  });

  return (
    <>
      <AuthHeading title="Create an account">
        Register for {systemName}. A church administrator reviews every registration before it can be used.
      </AuthHeading>
      <form onSubmit={onSubmit} className="space-y-4" noValidate aria-busy={pending}>
        {error ? (
          <div className="flex gap-2.5 rounded-lg border border-destructive/25 bg-destructive/8 px-3.5 py-3 text-sm text-destructive" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First Name" htmlFor="first_name" required error={errors.first_name?.message}>
            <Input id="first_name" autoComplete="given-name" disabled={pending} className={FIELD} {...form.register("first_name")} />
          </Field>
          <Field label="Last Name" htmlFor="last_name" required error={errors.last_name?.message}>
            <Input id="last_name" autoComplete="family-name" disabled={pending} className={FIELD} {...form.register("last_name")} />
          </Field>
        </div>
        <Field label="Middle Name" htmlFor="middle_name" hint="Optional" error={errors.middle_name?.message}>
          <Input id="middle_name" autoComplete="additional-name" disabled={pending} className={FIELD} {...form.register("middle_name")} />
        </Field>
        <Field label="Email Address" htmlFor="email" required error={errors.email?.message}>
          <Input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" disabled={pending} className={FIELD} {...form.register("email")} />
        </Field>
        <Field label="Mobile Number" htmlFor="mobile_number" required error={errors.mobile_number?.message}>
          <Input id="mobile_number" type="tel" inputMode="tel" autoComplete="tel" placeholder="09XX XXX XXXX" disabled={pending} className={FIELD} {...form.register("mobile_number")} />
        </Field>
        <Field label="Password" htmlFor="password" required error={errors.password?.message} hint="At least 8 characters.">
          <div className="relative">
            <Input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" disabled={pending} className={`${FIELD} pr-11`} {...form.register("password")} />
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
        </Field>
        <Field label="Confirm Password" htmlFor="confirm" required error={errors.confirm?.message}>
          <Input id="confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" disabled={pending} className={FIELD} {...form.register("confirm")} />
        </Field>

        <div className="rounded-lg border bg-card p-4">
          <label className="flex items-start gap-3 text-sm font-medium">
            <Checkbox
              checked={Boolean(isMember)}
              onCheckedChange={(checked) => form.setValue("is_existing_member", Boolean(checked))}
              disabled={pending}
              className="mt-0.5"
            />
            <span>
              I am already a member of the church
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                An administrator will match your account to your existing member record.
              </span>
            </span>
          </label>
          {isMember ? (
            <div className="mt-4 border-t pt-4">
              <Field
                label="Help us find your record"
                htmlFor="member_hint"
                hint="For example your cell group, your leader's name, or your birthday. Only administrators see this."
                error={errors.member_hint?.message}
              >
                <Textarea id="member_hint" rows={2} disabled={pending} {...form.register("member_hint")} />
              </Field>
            </div>
          ) : null}
        </div>

        <PendingButton type="submit" pending={pending} pendingText="Submitting…" className="h-11 w-full rounded-lg text-base sm:text-sm">
          Create Account
        </PendingButton>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-link underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </>
  );
}

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const form = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await requestPasswordReset(values);
      if (result.ok) {
        setSent(true);
      } else {
        toast.error(result.error);
      }
    });
  });

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <CircleCheck className="mx-auto size-10 text-success" aria-hidden />
        <p className="text-sm text-muted-foreground">
          If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.
        </p>
        <Link href="/login" className="text-sm text-link hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <AuthHeading title="Forgot your password?">Enter your email and we&apos;ll send you a link to choose a new one.</AuthHeading>
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field label="Email Address" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" autoFocus className={FIELD} {...form.register("email")} />
        </Field>
        <PendingButton type="submit" pending={pending} pendingText="Sending…" className="h-11 w-full rounded-lg text-base sm:text-sm">
          Send reset link
        </PendingButton>
        <p className="text-center text-sm">
          <Link href="/login" className="font-medium text-link underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </>
  );
}

/** Used on the reset page and on the profile page ("Change password"). */
export function PasswordForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const result = await updatePassword(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Password updated");
      form.reset();
      if (redirectTo) {
        router.replace(redirectTo);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <ErrorBanner message={error} />
      <Field label="New password" htmlFor="password" error={form.formState.errors.password?.message} hint="At least 8 characters.">
        <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
      </Field>
      <PendingButton type="submit" pending={pending} pendingText="Saving…" className="w-full sm:w-auto">
        Update password
      </PendingButton>
    </form>
  );
}
