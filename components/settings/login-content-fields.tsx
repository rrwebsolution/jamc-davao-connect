"use client";

import type { CSSProperties } from "react";
import { RotateCcw } from "lucide-react";
import { resetLoginContent } from "@/app/(app)/admin/settings/actions";
import { LoginVerse, LoginWelcome, visibleLoginContent } from "@/components/auth/login-content";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field, FormSection } from "@/components/shared/form";
import { brandVariables, LOGIN_CONTENT_LIMITS, type LoginContent, type ThemeColors } from "@/lib/theme";
import { typographyVariables, type Typography } from "@/lib/typography";

type SetContent = <K extends keyof LoginContent>(key: K, value: LoginContent[K]) => void;

function Count({ value, max }: { value: string; max: number }) {
  return (
    <span className={`tabular-nums ${value.length > max ? "font-medium text-destructive" : "text-muted-foreground"}`}>
      {value.length} / {max}
    </span>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span>
        {label}
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Appearance → Login page content. Edits are previewed at once and saved
 * together with the rest of the appearance when the administrator saves.
 */
export function LoginContentSection({
  values,
  colors,
  typography,
  systemName,
  tagline,
  hasBackground,
  set,
  onReset,
  disabled,
}: {
  values: LoginContent;
  colors: ThemeColors;
  typography: Typography;
  systemName: string;
  tagline: string;
  /** Whether a login background picture is set (it is shown above this text). */
  hasBackground: boolean;
  set: SetContent;
  /** Called after the saved content was put back to the defaults. */
  onReset: () => void;
  disabled: boolean;
}) {
  const shown = visibleLoginContent(values);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <FormSection title="Login page content" description="The welcome message and Bible verse shown beside the sign-in form. Hiding a part keeps its text for later.">
        <div className="space-y-4">
          <Field label="Welcome message" htmlFor="login_welcome_message">
            <Textarea
              id="login_welcome_message"
              rows={3}
              maxLength={LOGIN_CONTENT_LIMITS.login_welcome_message}
              value={values.login_welcome_message}
              onChange={(event) => set("login_welcome_message", event.target.value)}
            />
            <p className="text-right text-xs">
              <Count value={values.login_welcome_message} max={LOGIN_CONTENT_LIMITS.login_welcome_message} />
            </p>
          </Field>
          <Toggle
            checked={values.show_login_welcome_message}
            onChange={(checked) => set("show_login_welcome_message", checked)}
            label="Show welcome message"
            hint="On the login, sign-up and password pages."
          />
        </div>

        <div className="mt-5 space-y-4 border-t pt-5">
          <Field label="Bible verse" htmlFor="login_bible_verse" hint="Quotation marks are added for you.">
            <Textarea
              id="login_bible_verse"
              rows={3}
              maxLength={LOGIN_CONTENT_LIMITS.login_bible_verse}
              value={values.login_bible_verse}
              onChange={(event) => set("login_bible_verse", event.target.value)}
            />
            <p className="text-right text-xs">
              <Count value={values.login_bible_verse} max={LOGIN_CONTENT_LIMITS.login_bible_verse} />
            </p>
          </Field>
          <Field label="Bible verse reference" htmlFor="login_bible_verse_reference" hint="For example Hebrews 10:24. Leave empty to show the verse on its own.">
            <Input
              id="login_bible_verse_reference"
              maxLength={LOGIN_CONTENT_LIMITS.login_bible_verse_reference}
              value={values.login_bible_verse_reference}
              onChange={(event) => set("login_bible_verse_reference", event.target.value)}
              className="sm:max-w-xs"
            />
          </Field>
          <Toggle
            checked={values.show_login_bible_verse}
            onChange={(checked) => set("show_login_bible_verse", checked)}
            label="Show Bible verse"
            hint="On phones the verse appears below the form."
          />
        </div>

        <div className="mt-5 border-t pt-4">
          <ConfirmButton
            action={async () => {
              const result = await resetLoginContent();
              if (result.ok) onReset();
              return result;
            }}
            title="Reset login page content?"
            description="The welcome message, Bible verse and reference go back to the original text, and both are shown again. This takes effect immediately."
            confirmLabel="Reset"
            successMessage="Login page content reset to default"
            destructive
            variant="ghost"
            size="sm"
            disabled={disabled}
          >
            <RotateCcw /> Reset login content to default
          </ConfirmButton>
        </div>
      </FormSection>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <FormSection title="Login page preview">
          <div
            className="theme-scope type-scope overflow-hidden rounded-xl border bg-sidebar p-5 text-sidebar-foreground"
            style={{ ...brandVariables(colors), ...typographyVariables(typography, { device: "desktop" }) } as CSSProperties}
            aria-label="Login page content preview"
          >
            <p data-type="display" className="text-2xl tracking-tight">
              {systemName}
            </p>
            {tagline ? <p className="mt-1 text-base opacity-90">{tagline}</p> : null}
            <LoginWelcome message={shown.message} className="mt-4 text-sm opacity-80" />
            <LoginVerse verse={shown.verse} reference={shown.reference} className="mt-5 border-l border-current/25 pl-4 text-sm opacity-70" />
            {!shown.message && !shown.verse ? <p className="mt-4 text-xs opacity-60">Only the name and tagline are shown.</p> : null}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {hasBackground ? "The panel uses the sidebar colours; the login background is shown above this text in a frame." : "The panel uses the sidebar colours."}
          </p>
        </FormSection>
      </div>
    </div>
  );
}
