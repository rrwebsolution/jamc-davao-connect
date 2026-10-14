"use client";

import { useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { ImagePlus, LayoutDashboard, Moon, RotateCcw, Sun, Trash2, Users } from "lucide-react";
import { resetBackground } from "@/app/(app)/admin/settings/actions";
import { SystemBackground } from "@/components/app/system-background";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field, FormSection, NativeSelect } from "@/components/shared/form";
import {
  BACKGROUND_LIMITS,
  BACKGROUND_POSITIONS,
  BACKGROUND_SIZES,
  surfaceVariables,
  type SystemBackgroundSettings,
} from "@/lib/background";
import { compressPhoto } from "@/lib/image-tools";
import { brandVariables, HEX_COLOR, type ThemeColors } from "@/lib/theme";

type SetBackground = <K extends keyof SystemBackgroundSettings>(key: K, value: SystemBackgroundSettings[K]) => void;

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
// The original may be a large phone photo; it is shrunk before it is uploaded.
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

function Range({
  id,
  label,
  value,
  unit,
  limit,
  step = 1,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  unit: string;
  limit: { min: number; max: number };
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "opacity-60" : undefined}>
      <label htmlFor={id} className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value}
          {unit}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={limit.min}
        max={limit.max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-primary"
      />
    </div>
  );
}

function ColorField({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const valid = HEX_COLOR.test(value);
  return (
    <Field label={label} htmlFor={id} error={valid ? undefined : "Use a 6-digit HEX colour, like #FFFFFF"}>
      <div className="flex gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={valid ? value : "#000000"}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="size-8 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-0.5 max-md:size-11"
        />
        <Input
          id={id}
          value={value}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value.trim().toUpperCase();
            onChange(next && !next.startsWith("#") ? `#${next}` : next);
          }}
          className="font-mono"
        />
      </div>
    </Field>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 text-sm ${disabled ? "opacity-60" : ""}`}>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <span>
        {label}
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/** A small copy of the application over the background being edited. */
function BackgroundPreview({ values, colors, imageUrl, shortName }: { values: SystemBackgroundSettings; colors: ThemeColors; imageUrl: string | null; shortName: string }) {
  const [mode, setMode] = useState<"light" | "dark">("light");
  const shown = values.system_background_enabled && imageUrl;
  const modes = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ] as const;

  return (
    <>
      <div className="mb-3 inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Preview theme">
        {modes.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => setMode(option.value)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
              mode === option.value ? "bg-accent font-medium" : "text-muted-foreground"
            }`}
          >
            <option.icon className="size-3.5" aria-hidden /> {option.label}
          </button>
        ))}
      </div>
      <div
        className={`${mode === "dark" ? "theme-scope dark" : "theme-scope"} relative isolate min-h-72 overflow-hidden rounded-xl border bg-background text-sm`}
        style={{ ...brandVariables(colors), ...(shown ? surfaceVariables(values) : {}) } as CSSProperties}
        data-system-bg={shown ? "on" : undefined}
        data-card-style={shown ? values.card_background_style : undefined}
        aria-label="Background preview"
      >
        {shown ? <SystemBackground imageUrl={imageUrl} settings={values} contained mode={mode} /> : null}
        <div className="relative z-10 flex min-h-72">
          <div className="hidden w-32 shrink-0 flex-col gap-1 bg-sidebar p-2 text-sidebar-foreground sm:flex">
            <p className="truncate px-2 py-1.5 text-xs font-semibold">{shortName}</p>
            <span className="flex items-center gap-2 rounded-md bg-sidebar-primary px-2 py-1.5 text-xs font-medium text-sidebar-primary-foreground">
              <LayoutDashboard className="size-3.5" aria-hidden /> Dashboard
            </span>
            <span className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs opacity-85">
              <Users className="size-3.5" aria-hidden /> Members
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex h-10 items-center border-b bg-navbar px-3 text-xs font-semibold text-navbar-foreground">Dashboard</div>
            <div className="space-y-3 p-3 text-foreground">
              <div>
                <p className="text-base font-semibold">Welcome back</p>
                <p className="text-xs text-muted-foreground">Text directly on the background, like page titles.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border bg-card p-3 text-card-foreground">
                  <p className="text-xs text-muted-foreground">Total members</p>
                  <p className="text-xl font-semibold">128</p>
                </div>
                <div className="rounded-lg border bg-card p-3 text-card-foreground">
                  <p className="text-xs text-muted-foreground">Sunday attendance</p>
                  <p className="text-xl font-semibold">96</p>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-3 text-card-foreground">
                <p className="text-xs font-medium">Upcoming events</p>
                <p className="text-xs text-muted-foreground">Sunday Worship · 10:00 AM</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {!imageUrl
          ? "No picture yet: the normal background colour is used."
          : !values.system_background_enabled
            ? "The picture is switched off: the normal background colour is used."
            : "In the application the picture stays still while the page scrolls over it."}
      </p>
    </>
  );
}

/**
 * Appearance → Background: a picture fixed behind the signed-in application.
 * Edits are previewed at once and saved with the rest of the appearance.
 */
export function BackgroundSection({
  values,
  colors,
  shortName,
  imageUrl,
  onChoose,
  onRemove,
  set,
  onReset,
  disabled,
}: {
  values: SystemBackgroundSettings;
  colors: ThemeColors;
  shortName: string;
  /** The picture to show: a newly chosen one, or the saved one. */
  imageUrl: string | null;
  /** A new picture, already shrunk. It is uploaded when the administrator saves. */
  onChoose: (file: File) => void;
  onRemove: () => void;
  set: SetBackground;
  /** Called after the saved background settings were put back to the defaults. */
  onReset: () => void;
  disabled: boolean;
}) {
  const [working, setWorking] = useState(false);
  const off = !values.system_background_enabled || !imageUrl;

  async function choose(file: File | undefined) {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      toast.error("Please choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      toast.error("That image is larger than 15 MB. Please choose a smaller one.");
      return;
    }
    setWorking(true);
    try {
      // Shrunk and saved as WebP here, so a huge photo is never uploaded or served.
      const optimized = await compressPhoto(file);
      onChoose(optimized);
      set("system_background_enabled", true);
      toast.success(`Picture ready (${Math.max(1, Math.round(optimized.size / 1024))} KB). Save changes to apply it.`);
    } catch {
      toast.error("That image could not be prepared. Please try another one.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <FormSection
        title="Background"
        description="A picture behind the application (Dashboard, Members and the rest). It stays still while pages scroll over it. The login page has its own background, set under Branding."
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="checkerboard flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="System background preview" className="size-full object-cover" />
            ) : (
              <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className={`${buttonVariants({ variant: "outline", size: "sm" })} cursor-pointer ${working ? "pointer-events-none opacity-60" : ""}`}>
              {working ? "Preparing…" : imageUrl ? "Replace background" : "Upload background"}
              <input
                type="file"
                accept={PHOTO_TYPES.join(",")}
                className="sr-only"
                disabled={working}
                onChange={(event) => {
                  void choose(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            {imageUrl ? (
              <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
                <Trash2 /> Remove background
              </Button>
            ) : null}
          </div>
          <p className="w-full text-xs text-muted-foreground">JPG, PNG or WebP. Large photos are resized and compressed automatically before upload.</p>
        </div>

        <div className="mt-5 border-t pt-5">
          <Toggle
            checked={values.system_background_enabled}
            onChange={(checked) => set("system_background_enabled", checked)}
            disabled={!imageUrl}
            label="Use system background image"
            hint="Off shows the normal background colour, without removing the picture."
          />
        </div>

        <div className={`mt-5 grid grid-cols-1 gap-4 border-t pt-5 sm:grid-cols-2 ${off ? "opacity-60" : ""}`}>
          <Field label="Background size" htmlFor="background_size">
            <NativeSelect id="background_size" value={values.background_size} disabled={off} onChange={(event) => set("background_size", event.target.value as SystemBackgroundSettings["background_size"])}>
              {BACKGROUND_SIZES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Background position" htmlFor="background_position">
            <NativeSelect
              id="background_position"
              value={values.background_position}
              disabled={off}
              onChange={(event) => set("background_position", event.target.value as SystemBackgroundSettings["background_position"])}
            >
              {BACKGROUND_POSITIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Range id="background_blur" label="Background blur" value={values.background_blur} unit="px" limit={BACKGROUND_LIMITS.background_blur} disabled={off} onChange={(value) => set("background_blur", value)} />
          <Range
            id="background_brightness"
            label="Background brightness"
            value={values.background_brightness}
            unit="%"
            limit={BACKGROUND_LIMITS.background_brightness}
            step={5}
            disabled={off}
            onChange={(value) => set("background_brightness", value)}
          />
        </div>

        <div className={`mt-5 space-y-4 border-t pt-5 ${off ? "opacity-60" : ""}`}>
          <Toggle
            checked={values.background_overlay_enabled}
            onChange={(checked) => set("background_overlay_enabled", checked)}
            disabled={off}
            label="Background overlay"
            hint="A colour laid over the picture so text and cards stay readable. Recommended."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Light mode</p>
              <ColorField
                id="background_overlay_color_light"
                label="Overlay colour"
                value={values.background_overlay_color_light}
                disabled={off || !values.background_overlay_enabled}
                onChange={(value) => set("background_overlay_color_light", value)}
              />
              <Range
                id="background_overlay_opacity_light"
                label="Overlay opacity"
                value={values.background_overlay_opacity_light}
                unit="%"
                limit={BACKGROUND_LIMITS.background_overlay_opacity_light}
                step={5}
                disabled={off || !values.background_overlay_enabled}
                onChange={(value) => set("background_overlay_opacity_light", value)}
              />
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Dark mode</p>
              <ColorField
                id="background_overlay_color_dark"
                label="Overlay colour"
                value={values.background_overlay_color_dark}
                disabled={off || !values.background_overlay_enabled}
                onChange={(value) => set("background_overlay_color_dark", value)}
              />
              <Range
                id="background_overlay_opacity_dark"
                label="Overlay opacity"
                value={values.background_overlay_opacity_dark}
                unit="%"
                limit={BACKGROUND_LIMITS.background_overlay_opacity_dark}
                step={5}
                disabled={off || !values.background_overlay_enabled}
                onChange={(value) => set("background_overlay_opacity_dark", value)}
              />
            </div>
          </div>
          {values.background_overlay_enabled && Math.min(values.background_overlay_opacity_light, values.background_overlay_opacity_dark) < 40 && !off ? (
            <p className="rounded-lg bg-warning/15 p-3 text-xs">A light overlay can make page titles hard to read over a busy picture. 40–75% usually works well.</p>
          ) : null}
        </div>

        <div className={`mt-5 grid grid-cols-1 gap-4 border-t pt-5 sm:grid-cols-2 ${off ? "opacity-60" : ""}`}>
          <Field label="Card background style" htmlFor="card_background_style" hint="Dialogs and menus always stay solid." className="sm:col-span-2 sm:max-w-xs">
            <NativeSelect
              id="card_background_style"
              value={values.card_background_style}
              disabled={off}
              onChange={(event) => set("card_background_style", event.target.value as SystemBackgroundSettings["card_background_style"])}
            >
              <option value="solid">Solid</option>
              <option value="translucent">Slightly transparent</option>
            </NativeSelect>
          </Field>
          <Range id="sidebar_opacity" label="Sidebar opacity" value={values.sidebar_opacity} unit="%" limit={BACKGROUND_LIMITS.sidebar_opacity} step={5} disabled={off} onChange={(value) => set("sidebar_opacity", value)} />
          <Range id="navbar_opacity" label="Navbar opacity" value={values.navbar_opacity} unit="%" limit={BACKGROUND_LIMITS.navbar_opacity} step={5} disabled={off} onChange={(value) => set("navbar_opacity", value)} />
        </div>

        <div className="mt-5 border-t pt-4">
          <ConfirmButton
            action={async () => {
              const result = await resetBackground();
              if (result.ok) onReset();
              return result;
            }}
            title="Reset system background settings?"
            description="This will restore the default background appearance: the picture is switched off and the overlay, blur and other options go back to their defaults. The uploaded picture is kept. It takes effect immediately for everyone."
            confirmLabel="Reset"
            successMessage="Background settings reset to default"
            destructive
            variant="ghost"
            size="sm"
            disabled={disabled}
          >
            <RotateCcw /> Reset background settings
          </ConfirmButton>
        </div>
      </FormSection>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <FormSection title="Background preview">
          <BackgroundPreview values={values} colors={colors} imageUrl={imageUrl} shortName={shortName} />
        </FormSection>
      </div>
    </div>
  );
}
