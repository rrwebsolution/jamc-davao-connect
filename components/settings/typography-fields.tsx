"use client";

import { useState, type CSSProperties } from "react";
import { Monitor, RotateCcw, Smartphone } from "lucide-react";
import { resetTypography } from "@/app/(app)/admin/settings/actions";
import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field, FormSection, NativeSelect } from "@/components/shared/form";
import { brandVariables, type ThemeColors } from "@/lib/theme";
import {
  BASE_SIZE,
  BASE_SIZE_PRESETS,
  BODY_WEIGHTS,
  DEFAULT_TYPOGRAPHY,
  FONTS,
  HEADING_WEIGHTS,
  nearestWeight,
  SIZE_FIELDS,
  typographyVariables,
  WEIGHT_LABELS,
  weightsFor,
  type Typography,
} from "@/lib/typography";

type SetTypography = <K extends keyof Typography>(key: K, value: Typography[K]) => void;

/** A pixel size within limits. Typing is free; the value is pulled into range on leaving the field. */
function SizeInput({
  id,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(value) ? value : ""}
        aria-invalid={value < min || value > max}
        onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))}
        onBlur={() => onChange(Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min)}
        className="w-24"
      />
      <span className="text-sm text-muted-foreground">px</span>
    </div>
  );
}

/** A sample screen drawn with the typography (and colours) being edited. */
function TypographyPreview({ values, colors, systemName, tagline }: { values: Typography; colors: ThemeColors; systemName: string; tagline: string }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const devices = [
    { value: "desktop", label: "Desktop", icon: Monitor },
    { value: "mobile", label: "Phone", icon: Smartphone },
  ] as const;

  return (
    <>
      <div className="mb-3 inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Preview size">
        {devices.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={device === option.value}
            onClick={() => setDevice(option.value)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
              device === option.value ? "bg-accent font-medium" : "text-muted-foreground"
            }`}
          >
            <option.icon className="size-3.5" aria-hidden /> {option.label}
          </button>
        ))}
      </div>
      <div
        className={`theme-scope type-scope overflow-hidden rounded-xl border bg-background p-4 ${device === "mobile" ? "mx-auto max-w-80" : ""}`}
        style={{ ...brandVariables(colors), ...typographyVariables(values, { device }) } as CSSProperties}
        aria-label="Typography preview"
      >
        <p className="text-xs text-muted-foreground">{systemName}</p>
        <h1>Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Welcome back to {systemName}.</p>
        <p className="mt-1 text-xs text-muted-foreground">{tagline}</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-card p-3 text-card-foreground">
            <p className="text-xs text-muted-foreground">Total Members</p>
            <p className="text-2xl font-semibold">128</p>
          </div>
          <div className="rounded-lg border bg-card p-3 text-card-foreground">
            <p className="text-xs text-muted-foreground">Sunday Attendance</p>
            <p className="text-2xl font-semibold">96</p>
          </div>
        </div>

        <div className="mt-3 rounded-lg border bg-card p-3 text-card-foreground">
          <h2>Recent Activity</h2>
          <table className="type-table mt-2 w-full">
            <tbody>
              <tr className="border-t">
                <td className="py-1.5">Juan Dela Cruz</td>
                <td className="py-1.5 text-right text-muted-foreground">Joined Grace Cell Group</td>
              </tr>
              <tr className="border-t">
                <td className="py-1.5">Maria Santos</td>
                <td className="py-1.5 text-right text-muted-foreground">First-time visitor</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 rounded-lg border bg-card p-3 text-card-foreground">
          <h3>Member details</h3>
          <p className="mt-2 text-sm font-medium">Input Label</p>
          <div className="type-input mt-1 flex h-9 items-center rounded-lg border border-input px-2.5 text-muted-foreground">Example Input</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="type-button rounded-lg bg-button px-3 py-1.5 font-medium text-button-foreground">Primary Button</span>
            <span className="type-button rounded-lg border px-3 py-1.5 font-medium">Cancel</span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-lg bg-sidebar p-2 text-sidebar-foreground">
          <span className="type-sidebar rounded-md bg-sidebar-primary px-2.5 py-1.5 font-medium text-sidebar-primary-foreground">Dashboard</span>
          <span className="type-sidebar px-2.5 py-1.5 opacity-85">Members</span>
          <span className="type-sidebar px-2.5 py-1.5 opacity-85">Attendance</span>
        </div>
      </div>
    </>
  );
}

/**
 * Appearance → Typography. Edits are previewed at once and saved together
 * with the rest of the appearance when the administrator saves.
 */
export function TypographySection({
  values,
  colors,
  systemName,
  tagline,
  set,
  onReset,
  disabled,
}: {
  values: Typography;
  colors: ThemeColors;
  systemName: string;
  tagline: string;
  set: SetTypography;
  /** Called after the saved typography was put back to the defaults. */
  onReset: () => void;
  disabled: boolean;
}) {
  const headingFont = values.heading_font === "same" ? values.primary_font : values.heading_font;
  const bodyWeights = weightsFor(values.primary_font, BODY_WEIGHTS);
  const headingWeights = weightsFor(headingFont, HEADING_WEIGHTS);
  const isPreset = BASE_SIZE_PRESETS.some((preset) => preset.value === values.base_font_size);

  // A font that lacks the chosen weight gets the nearest one it has.
  function choosePrimary(next: Typography["primary_font"]) {
    set("primary_font", next);
    set("body_font_weight", nearestWeight(next, BODY_WEIGHTS, values.body_font_weight));
    if (values.heading_font === "same") set("heading_font_weight", nearestWeight(next, HEADING_WEIGHTS, values.heading_font_weight));
  }
  function chooseHeading(next: Typography["heading_font"]) {
    set("heading_font", next);
    set("heading_font_weight", nearestWeight(next === "same" ? values.primary_font : next, HEADING_WEIGHTS, values.heading_font_weight));
  }

  const sizeField = (field: (typeof SIZE_FIELDS)[number]) => (
    <Field key={field.key} label={field.label} htmlFor={field.key} hint={`${field.min}–${field.max}px`}>
      <SizeInput id={field.key} value={values[field.key]} min={field.min} max={field.max} onChange={(value) => set(field.key, value)} />
    </Field>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <FormSection title="Typography" description="Fonts, weights and text sizes for the whole system, including the login page. The preview updates as you go; nothing is saved until you save.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary font" htmlFor="primary_font" hint="Body text, forms, tables, navigation and buttons.">
            <NativeSelect id="primary_font" value={values.primary_font} onChange={(event) => choosePrimary(event.target.value as Typography["primary_font"])}>
              {FONTS.map((font) => (
                <option key={font.key} value={font.key}>
                  {font.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Heading font" htmlFor="heading_font" hint="Page, section, card and dialog titles.">
            <NativeSelect id="heading_font" value={values.heading_font} onChange={(event) => chooseHeading(event.target.value as Typography["heading_font"])}>
              <option value="same">Same as primary</option>
              {FONTS.map((font) => (
                <option key={font.key} value={font.key}>
                  {font.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Default font weight" htmlFor="body_font_weight">
            <NativeSelect id="body_font_weight" value={String(values.body_font_weight)} onChange={(event) => set("body_font_weight", Number(event.target.value))}>
              {bodyWeights.map((weight) => (
                <option key={weight} value={weight}>
                  {WEIGHT_LABELS[weight]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Heading weight" htmlFor="heading_font_weight">
            <NativeSelect id="heading_font_weight" value={String(values.heading_font_weight)} onChange={(event) => set("heading_font_weight", Number(event.target.value))}>
              {headingWeights.map((weight) => (
                <option key={weight} value={weight}>
                  {WEIGHT_LABELS[weight]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2">
          <Field
            label="Base font size"
            htmlFor="base_font_size"
            hint={`Scales text and spacing together, like zooming. ${BASE_SIZE.min}–${BASE_SIZE.max}px.`}
            className="sm:col-span-2"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-48 flex-1 sm:max-w-64">
                <NativeSelect
                  aria-label="Base font size preset"
                  value={isPreset ? String(values.base_font_size) : "custom"}
                  onChange={(event) => event.target.value !== "custom" && set("base_font_size", Number(event.target.value))}
                >
                  {BASE_SIZE_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                  {isPreset ? null : <option value="custom">Custom</option>}
                </NativeSelect>
              </div>
              <SizeInput id="base_font_size" value={values.base_font_size} min={BASE_SIZE.min} max={BASE_SIZE.max} onChange={(value) => set("base_font_size", value)} />
            </div>
          </Field>
          <Field label="Heading scale" htmlFor="heading_scale" hint="Makes every heading smaller or larger together.">
            <NativeSelect id="heading_scale" value={values.heading_scale} onChange={(event) => set("heading_scale", event.target.value as Typography["heading_scale"])}>
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="large">Large</option>
            </NativeSelect>
          </Field>
          <Field label="Mobile font scale" htmlFor="mobile_font_scale" hint="Applies on phones, on top of the base size.">
            <NativeSelect id="mobile_font_scale" value={values.mobile_font_scale} onChange={(event) => set("mobile_font_scale", event.target.value as Typography["mobile_font_scale"])}>
              <option value="compact">Compact (slightly smaller)</option>
              <option value="normal">Normal (recommended)</option>
              <option value="comfortable">Comfortable (slightly larger)</option>
            </NativeSelect>
          </Field>
          {SIZE_FIELDS.filter((field) => !field.advanced).map(sizeField)}
        </div>

        <details className="mt-5 border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">Advanced typography</summary>
          <p className="mt-1 text-xs text-muted-foreground">
            Sizes of individual text styles, set for the 16px base. They scale with the base size, the heading scale and the mobile scale.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">{SIZE_FIELDS.filter((field) => field.advanced).map(sizeField)}</div>
        </details>

        <div className="mt-5 border-t pt-4">
          <ConfirmButton
            action={async () => {
              const result = await resetTypography();
              if (result.ok) onReset();
              return result;
            }}
            title="Reset typography settings?"
            description="This will restore the default JAMC Davao Connect typography. Colours, names and images are kept. It takes effect immediately for everyone."
            confirmLabel="Reset"
            successMessage="Typography reset to default"
            destructive
            variant="ghost"
            size="sm"
            disabled={disabled}
          >
            <RotateCcw /> Reset typography to default
          </ConfirmButton>
        </div>
      </FormSection>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <FormSection title="Typography preview">
          <TypographyPreview values={values} colors={colors} systemName={systemName} tagline={tagline} />
          <p className="mt-3 text-xs text-muted-foreground">
            Defaults: {FONTS.find((font) => font.key === DEFAULT_TYPOGRAPHY.primary_font)?.label}, {DEFAULT_TYPOGRAPHY.base_font_size}px base, regular text and semibold headings.
          </p>
        </FormSection>
      </div>
    </div>
  );
}
