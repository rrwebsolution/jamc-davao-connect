"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eraser, ImagePlus, LayoutDashboard, RotateCcw, Trash2, TriangleAlert, Undo2, Users } from "lucide-react";
import { resetAppearance, saveAppearance } from "@/app/(app)/admin/settings/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field, FormSection, NativeSelect, PendingButton } from "@/components/shared/form";
import { BackgroundSection } from "@/components/settings/background-fields";
import { LoginContentSection } from "@/components/settings/login-content-fields";
import { MotionSection } from "@/components/settings/motion-fields";
import { TypographySection } from "@/components/settings/typography-fields";
import { BACKGROUND_RESET } from "@/lib/background";
import { removeBackground } from "@/lib/image-tools";
import { createClient } from "@/lib/supabase/client";
import { brandVariables, COLOR_FIELDS, contrastRatio, DEFAULT_LOGIN_CONTENT, HEX_COLOR, type Branding, type ColorKey } from "@/lib/theme";
import { DEFAULT_TYPOGRAPHY } from "@/lib/typography";
import { appearanceSchema } from "@/lib/validation";

/** What the root layout uses when no favicon is uploaded. */
const FALLBACK_FAVICON = "/pwa-icon/192";

/**
 * Shows a new favicon in this tab at once. A refresh re-renders the page but
 * browsers keep the tab icon until the <link> itself changes, so its address
 * is updated here (the next full load gets it from the layout as usual).
 */
function showFavicon(url: string) {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
    link.href = url;
  }
}

const ASSETS = [
  { key: "logo_path", label: "Church logo", hint: "Shown in the sidebar and on the left side of the login page. Both are dark, so a light logo works best." },
  {
    key: "login_logo_path",
    label: "Login logo — light mode",
    hint: "Above the sign-in form when the page is light. Use a dark or full-colour logo so it stands out.",
  },
  {
    key: "login_logo_dark_path",
    label: "Login logo — dark mode",
    hint: "Above the sign-in form when the page is dark. Use a light or white logo. If empty, the church logo is used.",
  },
  { key: "favicon_path", label: "Favicon", hint: "Browser tab icon. A square PNG or ICO works best." },
  { key: "login_background_path", label: "Login background", hint: "Shown beside the sign-in form on wide screens." },
] as const;

type AssetKey = (typeof ASSETS)[number]["key"];

// The two logos can be resized; each size applies where that logo is shown.
const LOGO_SIZING: Partial<Record<AssetKey, { field: "logo_size" | "login_logo_size"; label: string; min: number; max: number }>> = {
  logo_path: { field: "logo_size", label: "Size in the sidebar", min: 20, max: 48 },
  login_logo_path: { field: "login_logo_size", label: "Size on the login page", min: 32, max: 160 },
  // Both login logos share one size, so the form doesn't jump between modes.
  login_logo_dark_path: { field: "login_logo_size", label: "Size on the login page (shared with light mode)", min: 32, max: 160 },
};
type Values = Omit<Branding, "church_name" | "updated_at">;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"];
const MAX_BYTES = 2 * 1024 * 1024;

function valuesFrom(branding: Branding): Values {
  const { church_name, updated_at, ...values } = branding;
  void church_name;
  void updated_at;
  return values;
}

/** Sidebar, navbar, cards, buttons, links and inputs drawn with the colours being edited. */
function ThemePreview({ values, churchName }: { values: Values; churchName: string }) {
  return (
    <div
      className="theme-scope overflow-hidden rounded-xl border bg-background text-sm"
      style={brandVariables(values) as CSSProperties}
      aria-label="Live preview"
    >
      <div className="flex min-h-72">
        <div className="hidden w-36 shrink-0 flex-col gap-1 bg-sidebar p-2 text-sidebar-foreground sm:flex">
          <p className="truncate px-2 py-1.5 text-xs font-semibold">{values.system_short_name || "Short name"}</p>
          <span className="flex items-center gap-2 rounded-md bg-sidebar-primary px-2 py-1.5 text-xs font-medium text-sidebar-primary-foreground">
            <LayoutDashboard className="size-3.5" aria-hidden /> Dashboard
          </span>
          <span className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs opacity-85">
            <Users className="size-3.5" aria-hidden /> Members
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex h-10 items-center justify-between border-b bg-navbar px-3 text-xs font-semibold text-navbar-foreground">
            <span className="truncate">{values.system_name || "System name"}</span>
            <span className="truncate font-normal opacity-70">{churchName}</span>
          </div>
          <div className="space-y-3 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border bg-card p-3 text-card-foreground">
                <p className="text-xs text-muted-foreground">Total members</p>
                <p className="text-xl font-semibold">128</p>
                <p className="text-xs text-highlight">Sample figure</p>
              </div>
              <div className="rounded-lg border bg-card p-3 text-card-foreground">
                <p className="text-xs text-muted-foreground">Attendance</p>
                <div className="mt-2 flex h-8 items-end gap-1" aria-hidden>
                  {[40, 65, 50, 80, 70].map((height, index) => (
                    <span key={index} className="flex-1 rounded-t bg-chart-1" style={{ height: `${height}%` }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-lg border bg-card p-3 text-card-foreground">
              <p className="mb-2 text-xs font-medium">Form input</p>
              <div className="h-8 rounded-lg border border-input px-2.5 text-xs leading-8 text-muted-foreground">Juan dela Cruz</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-button px-3 py-1.5 text-xs font-medium text-button-foreground">Save changes</span>
                <span className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">Cancel</span>
                <span className="text-xs text-link underline underline-offset-2">View profile</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppearanceForm({
  branding,
  assetBaseUrl,
}: {
  branding: Branding;
  assetBaseUrl: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Values>(() => valuesFrom(branding));
  const [values, setValues] = useState<Values>(() => valuesFrom(branding));
  const [files, setFiles] = useState<Partial<Record<AssetKey, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<AssetKey, string>>>({});
  const [pending, startTransition] = useTransition();

  // Object URLs of newly chosen images, released when replaced and on unmount.
  const objectUrls = useRef<Partial<Record<AssetKey, string>>>({});
  useEffect(() => {
    const urls = objectUrls.current;
    return () => Object.values(urls).forEach((url) => url && URL.revokeObjectURL(url));
  }, []);

  function setPreview(key: AssetKey, file: File | null) {
    const previous = objectUrls.current[key];
    if (previous) URL.revokeObjectURL(previous);
    if (file) objectUrls.current[key] = URL.createObjectURL(file);
    else delete objectUrls.current[key];
    setPreviews({ ...objectUrls.current });
  }

  // The system background picture, chosen but not uploaded yet (it is uploaded on Save).
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const backgroundUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (backgroundUrl.current) URL.revokeObjectURL(backgroundUrl.current);
    },
    [],
  );
  function chooseBackground(file: File | null) {
    if (backgroundUrl.current) URL.revokeObjectURL(backgroundUrl.current);
    backgroundUrl.current = file ? URL.createObjectURL(file) : null;
    setBackgroundFile(file);
    setBackgroundPreview(backgroundUrl.current);
  }

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(saved) || Object.keys(files).length > 0 || backgroundFile !== null,
    [values, saved, files, backgroundFile],
  );
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((current) => ({ ...current, [key]: value }));

  const invalidColors = COLOR_FIELDS.filter((field) => !HEX_COLOR.test(values[field.key]));
  const lowContrast = [
    { name: "Button text on button", ratio: contrastRatio(values.button_color, values.button_text_color) },
    { name: "Sidebar text on sidebar", ratio: contrastRatio(values.sidebar_background_color, values.sidebar_text_color) },
    { name: "Link on card", ratio: contrastRatio(values.card_color, values.link_color) },
  ].filter((pair) => pair.ratio < 4.5);

  // Background removal always starts again from the untouched image, so the
  // strength can be changed and tried again without the result degrading.
  const originals = useRef<Partial<Record<AssetKey, File>>>({});
  const [strength, setStrength] = useState<Partial<Record<AssetKey, number>>>({});
  const [cleaned, setCleaned] = useState<Partial<Record<AssetKey, boolean>>>({});
  const [working, setWorking] = useState<AssetKey | null>(null);

  function chooseFile(key: AssetKey, file: File | undefined) {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error("Please choose a PNG, JPG, WebP or ICO image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("That image is larger than 2 MB.");
      return;
    }
    originals.current[key] = file;
    setCleaned((current) => ({ ...current, [key]: false }));
    setFiles((current) => ({ ...current, [key]: file }));
    setPreview(key, file);
  }

  function removeAsset(key: AssetKey) {
    delete originals.current[key];
    setCleaned((current) => ({ ...current, [key]: false }));
    setFiles((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPreview(key, null);
    set(key, null);
  }

  /** Makes the logo's plain background transparent. The result is uploaded on Save like any new image. */
  async function cleanBackground(key: AssetKey, tolerance: number) {
    const source = originals.current[key] ?? (values[key] ? `${assetBaseUrl}/${values[key]}` : null);
    if (!source) return;
    setWorking(key);
    try {
      const result = await removeBackground(source, tolerance);
      if (result.size > MAX_BYTES) {
        toast.error("The result is larger than 2 MB. Try a smaller image.");
        return;
      }
      setFiles((current) => ({ ...current, [key]: result }));
      setPreview(key, result);
      setCleaned((current) => ({ ...current, [key]: true }));
    } catch {
      toast.error("The background could not be removed from this image.");
    } finally {
      setWorking(null);
    }
  }

  /** Back to the image as it was before the background was removed. */
  function restoreBackground(key: AssetKey) {
    const original = originals.current[key];
    setCleaned((current) => ({ ...current, [key]: false }));
    if (original) {
      setFiles((current) => ({ ...current, [key]: original }));
      setPreview(key, original);
    } else {
      setFiles((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setPreview(key, null);
    }
  }

  function clearFiles() {
    for (const asset of ASSETS) setPreview(asset.key, null);
    originals.current = {};
    setCleaned({});
    setFiles({});
    chooseBackground(null);
  }

  function cancel() {
    setValues(saved);
    clearFiles();
  }

  function save() {
    const check = appearanceSchema.safeParse(values);
    if (!check.success) {
      toast.error(check.error.issues[0]?.message ?? "Please check the form.");
      return;
    }
    startTransition(async () => {
      const next = { ...values };
      const supabase = createClient();
      for (const [key, file] of Object.entries(files) as [AssetKey, File][]) {
        const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "png";
        const path = `${key.replace("_path", "")}-${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from("branding").upload(path, file, { contentType: file.type });
        if (error) {
          toast.error("An image could not be uploaded. Nothing was saved.");
          return;
        }
        next[key] = path;
      }
      if (backgroundFile) {
        const path = `system-background-${crypto.randomUUID()}.webp`;
        const { error } = await supabase.storage.from("branding").upload(path, backgroundFile, { contentType: backgroundFile.type });
        if (error) {
          toast.error("The background picture could not be uploaded. Nothing was saved.");
          return;
        }
        next.system_background_path = path;
      }

      const result = await saveAppearance(next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (next.favicon_path !== saved.favicon_path) {
        showFavicon(next.favicon_path ? `${assetBaseUrl}/${next.favicon_path}` : FALLBACK_FAVICON);
      }
      setValues(next);
      setSaved(next);
      clearFiles();
      toast.success("Appearance saved");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <FormSection title="Branding" description="Names and images used across the system and on the login page.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="System name" htmlFor="system_name" required>
            <Input id="system_name" maxLength={80} value={values.system_name} onChange={(e) => set("system_name", e.target.value)} />
          </Field>
          <Field label="System short name" htmlFor="system_short_name" required hint="Shown in the sidebar and browser tab.">
            <Input id="system_short_name" maxLength={30} value={values.system_short_name} onChange={(e) => set("system_short_name", e.target.value)} />
          </Field>
          <Field label="Tagline" htmlFor="tagline" className="sm:col-span-2">
            <Input id="tagline" maxLength={120} value={values.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">The church name is edited under General.</p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {ASSETS.map((asset) => {
            const current = previews[asset.key] ?? (values[asset.key] ? `${assetBaseUrl}/${values[asset.key]}` : null);
            const sizing = LOGO_SIZING[asset.key];
            const level = strength[asset.key] ?? 40;
            return (
              <div key={asset.key} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{asset.label}</p>
                <p className="mb-3 text-xs text-muted-foreground">{asset.hint}</p>
                <div className="flex items-center gap-3">
                  {/* The checkerboard shows through wherever the image is transparent. */}
                  <div className="checkerboard flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
                    {current ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={current} alt={`${asset.label} preview`} className="size-full object-contain" />
                    ) : (
                      <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className={`${buttonVariants({ variant: "outline", size: "sm" })} cursor-pointer`}>
                      {current ? "Replace" : "Upload"}
                      <input
                        type="file"
                        accept={IMAGE_TYPES.join(",")}
                        className="sr-only"
                        onChange={(event) => {
                          chooseFile(asset.key, event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    {current ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeAsset(asset.key)}>
                        <Trash2 /> Remove
                      </Button>
                    ) : null}
                  </div>
                </div>

                {sizing && current ? (
                  <div className="mt-4 space-y-4 border-t pt-4">
                    <div>
                      <label htmlFor={`${asset.key}-size`} className="flex items-center justify-between text-sm">
                        <span>{sizing.label}</span>
                        <span className="tabular-nums text-muted-foreground">{values[sizing.field]} px</span>
                      </label>
                      <input
                        id={`${asset.key}-size`}
                        type="range"
                        min={sizing.min}
                        max={sizing.max}
                        step={2}
                        value={values[sizing.field]}
                        onChange={(event) => set(sizing.field, Number(event.target.value))}
                        className="mt-2 w-full accent-primary"
                      />
                      {/* The logo at exactly the size it will have in its place. */}
                      <div
                        className={`mt-2 flex items-center gap-2.5 overflow-hidden rounded-lg border px-3 ${
                          sizing.field === "logo_size" ? "h-14 bg-sidebar text-sidebar-foreground" : asset.key === "login_logo_dark_path" ? "min-h-14 justify-center bg-neutral-900 py-3" : "min-h-14 justify-center bg-white py-3"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={current} alt="" style={{ height: values[sizing.field] }} className="w-auto max-w-full shrink-0 object-contain" />
                        {sizing.field === "logo_size" ? <span className="truncate text-sm font-semibold">{values.system_short_name}</span> : null}
                      </div>
                    </div>

                    <div>
                      <label htmlFor={`${asset.key}-strength`} className="flex items-center justify-between text-sm">
                        <span>Background remover</span>
                        <span className="text-xs text-muted-foreground">Strength {level}</span>
                      </label>
                      <input
                        id={`${asset.key}-strength`}
                        type="range"
                        min={5}
                        max={120}
                        step={5}
                        value={level}
                        onChange={(event) => setStrength((all) => ({ ...all, [asset.key]: Number(event.target.value) }))}
                        className="mt-2 w-full accent-primary"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <PendingButton
                          type="button"
                          variant="outline"
                          size="sm"
                          pending={working === asset.key}
                          pendingText="Removing…"
                          onClick={() => cleanBackground(asset.key, level)}
                        >
                          <Eraser /> {cleaned[asset.key] ? "Apply again" : "Remove background"}
                        </PendingButton>
                        {cleaned[asset.key] ? (
                          <Button type="button" variant="ghost" size="sm" onClick={() => restoreBackground(asset.key)}>
                            <Undo2 /> Undo
                          </Button>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Clears a plain background (white, or any single colour) and keeps the logo. Raise the strength if some
                        background is left; lower it if parts of the logo disappear.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">PNG, JPG, WebP or ICO, up to 2 MB each. Images are saved when you save changes.</p>
      </FormSection>

      <LoginContentSection
        values={values}
        colors={values}
        typography={values}
        systemName={values.system_name || "JAMC Davao Connect"}
        tagline={values.tagline}
        hasBackground={Boolean(previews.login_background_path ?? values.login_background_path)}
        set={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
        disabled={pending}
        onReset={() => {
          // The defaults are saved already; show them without losing other unsaved edits.
          setValues((current) => ({ ...current, ...DEFAULT_LOGIN_CONTENT }));
          setSaved((current) => ({ ...current, ...DEFAULT_LOGIN_CONTENT }));
        }}
      />

      <BackgroundSection
        values={values}
        colors={values}
        shortName={values.system_short_name || "JAMC Connect"}
        imageUrl={backgroundPreview ?? (values.system_background_path ? `${assetBaseUrl}/${values.system_background_path}` : null)}
        onChoose={chooseBackground}
        onRemove={() => {
          // Removed from the form now; the file itself is deleted when this is saved.
          chooseBackground(null);
          setValues((current) => ({ ...current, system_background_path: null, system_background_enabled: false }));
        }}
        set={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
        disabled={pending}
        onReset={() => {
          // The defaults are saved already; the picture is kept. Show them without losing other unsaved edits.
          setValues((current) => ({ ...current, ...BACKGROUND_RESET }));
          setSaved((current) => ({ ...current, ...BACKGROUND_RESET }));
        }}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <FormSection title="Colours" description="Pick a colour or type a HEX value. The preview updates as you go; nothing is saved until you save.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {COLOR_FIELDS.map((field) => {
              const value = values[field.key as ColorKey];
              const valid = HEX_COLOR.test(value);
              return (
                <Field
                  key={field.key}
                  label={field.label}
                  htmlFor={field.key}
                  hint={field.hint || undefined}
                  error={valid ? undefined : "Use a 6-digit HEX colour, like #7C2D12"}
                >
                  <div className="flex gap-2">
                    <input
                      type="color"
                      aria-label={`${field.label} colour picker`}
                      value={valid ? value : "#000000"}
                      onChange={(event) => set(field.key, event.target.value.toUpperCase())}
                      className="size-8 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-0.5"
                    />
                    <Input
                      id={field.key}
                      value={value}
                      maxLength={7}
                      spellCheck={false}
                      aria-invalid={!valid}
                      onChange={(event) => {
                        const next = event.target.value.trim().toUpperCase();
                        set(field.key, next && !next.startsWith("#") ? `#${next}` : next);
                      }}
                      className="font-mono"
                    />
                  </div>
                </Field>
              );
            })}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 border-t pt-5 sm:grid-cols-2">
            <Field label="Default theme" htmlFor="default_theme" hint="Custom colours apply to light mode; dark mode keeps the brand hues on dark surfaces.">
              <NativeSelect id="default_theme" value={values.default_theme} onChange={(e) => set("default_theme", e.target.value as Values["default_theme"])}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System (follow the device)</option>
              </NativeSelect>
            </Field>
            <label className="flex items-start gap-3 text-sm sm:pt-6">
              <Switch checked={values.allow_user_theme_override} onCheckedChange={(checked) => set("allow_user_theme_override", checked)} />
              <span>
                Allow user theme override
                <span className="block text-xs text-muted-foreground">
                  When on, each user can choose Light, Dark or System. When off, everyone gets the default.
                </span>
              </span>
            </label>
          </div>
        </FormSection>

        <div className="space-y-3 xl:sticky xl:top-20 xl:self-start">
          <FormSection title="Live preview">
            <ThemePreview values={values} churchName={branding.church_name} />
            {lowContrast.length > 0 ? (
              <div className="mt-3 flex gap-2 rounded-lg bg-warning/15 p-3 text-xs">
                <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
                <div>
                  <p className="font-medium">Some text may be hard to read</p>
                  <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                    {lowContrast.map((pair) => (
                      <li key={pair.name}>
                        {pair.name}: contrast {pair.ratio.toFixed(1)}:1 (aim for 4.5:1 or more)
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </FormSection>
        </div>
      </div>

      <TypographySection
        values={values}
        colors={values}
        systemName={values.system_name || "JAMC Davao Connect"}
        tagline={values.tagline}
        set={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
        disabled={pending}
        onReset={() => {
          // The defaults are saved already; show them without losing other unsaved edits.
          setValues((current) => ({ ...current, ...DEFAULT_TYPOGRAPHY }));
          setSaved((current) => ({ ...current, ...DEFAULT_TYPOGRAPHY }));
        }}
      />

      <MotionSection values={values} set={(key, value) => setValues((current) => ({ ...current, [key]: value }))} />

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <ConfirmButton
          action={resetAppearance}
          title="Reset colours to default?"
          description="All colours and the theme mode go back to the original JAMC Davao Connect theme. Names and images are kept. This takes effect immediately for everyone."
          confirmLabel="Reset to default"
          successMessage="Theme reset to default"
          destructive
          variant="ghost"
          disabled={pending}
        >
          <RotateCcw /> Reset colours to default
        </ConfirmButton>
        <div className="flex gap-2">
          <Button variant="outline" onClick={cancel} disabled={!dirty || pending}>
            Cancel
          </Button>
          <PendingButton pending={pending} pendingText="Saving…" disabled={!dirty || invalidColors.length > 0} onClick={save}>
            Save changes
          </PendingButton>
        </div>
      </div>
    </div>
  );
}
