// Typography settings: the font list, limits and the CSS variables they
// become. Shared by the server (root layout) and the client (live preview in
// Appearance settings), so it must stay free of server-only imports.

/**
 * The fonts an administrator can choose. Each one is self-hosted through
 * next/font (see lib/fonts.ts) and exposed as a CSS variable; there is no way
 * to enter another font or a URL. `weights` lists what the font really ships.
 */
export const FONTS = [
  { key: "inter", label: "Inter", variable: "--font-inter", weights: [300, 400, 500, 600, 700] },
  { key: "roboto", label: "Roboto", variable: "--font-roboto", weights: [300, 400, 500, 600, 700] },
  { key: "open_sans", label: "Open Sans", variable: "--font-open-sans", weights: [300, 400, 500, 600, 700] },
  { key: "lato", label: "Lato", variable: "--font-lato", weights: [300, 400, 700] },
  { key: "poppins", label: "Poppins", variable: "--font-poppins", weights: [300, 400, 500, 600, 700] },
  { key: "montserrat", label: "Montserrat", variable: "--font-montserrat", weights: [300, 400, 500, 600, 700] },
  { key: "nunito", label: "Nunito", variable: "--font-nunito", weights: [300, 400, 500, 600, 700] },
  { key: "source_sans_3", label: "Source Sans 3", variable: "--font-source-sans-3", weights: [300, 400, 500, 600, 700] },
  { key: "dm_sans", label: "DM Sans", variable: "--font-dm-sans", weights: [300, 400, 500, 600, 700] },
  { key: "manrope", label: "Manrope", variable: "--font-manrope", weights: [300, 400, 500, 600, 700] },
  { key: "system", label: "System default", variable: null, weights: [300, 400, 500, 600, 700] },
] as const;

export type FontKey = (typeof FONTS)[number]["key"];
export const FONT_KEYS = FONTS.map((font) => font.key) as [FontKey, ...FontKey[]];

/** Used after the chosen font, so text stays readable if it fails to load. */
const FALLBACK_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const WEIGHT_LABELS: Record<number, string> = { 300: "Light (300)", 400: "Regular (400)", 500: "Medium (500)", 600: "Semibold (600)", 700: "Bold (700)" };
export const BODY_WEIGHTS = [300, 400, 500] as const;
export const HEADING_WEIGHTS = [400, 500, 600, 700] as const;

export const HEADING_SCALES = { compact: 0.9, normal: 1, large: 1.15 } as const;
export const MOBILE_SCALES = { compact: 0.9375, normal: 1, comfortable: 1.0625 } as const;
export type HeadingScale = keyof typeof HEADING_SCALES;
export type MobileScale = keyof typeof MOBILE_SCALES;

export const BASE_SIZE = { min: 14, max: 20 } as const;
export const BASE_SIZE_PRESETS = [
  { value: 14, label: "Small (14px)" },
  { value: 15, label: "Compact (15px)" },
  { value: 16, label: "Normal (16px)" },
  { value: 17, label: "Comfortable (17px)" },
  { value: 18, label: "Large (18px)" },
] as const;

/**
 * Sizes of individual parts, in pixels at the 16px base. They scale together
 * with the base size and the mobile scale. The limits keep text readable and
 * controls usable.
 */
export const SIZE_FIELDS = [
  { key: "button_font_size", label: "Button font size", token: "--font-size-button", min: 12, max: 18, advanced: false },
  { key: "input_font_size", label: "Input font size", token: "--font-size-input", min: 12, max: 18, advanced: false },
  { key: "table_font_size", label: "Table / list font size", token: "--font-size-table", min: 12, max: 18, advanced: false },
  { key: "sidebar_font_size", label: "Sidebar font size", token: "--font-size-sidebar", min: 12, max: 18, advanced: false },
  { key: "page_title_font_size", label: "Page title", token: "--font-size-page-title", min: 20, max: 32, advanced: true },
  { key: "section_title_font_size", label: "Section heading", token: "--font-size-section-title", min: 14, max: 24, advanced: true },
  { key: "card_title_font_size", label: "Card / dialog title", token: "--font-size-card-title", min: 14, max: 20, advanced: true },
  { key: "body_font_size", label: "Body text", token: "--font-size-body", min: 14, max: 18, advanced: true },
  { key: "small_font_size", label: "Small text", token: "--font-size-small", min: 12, max: 16, advanced: true },
  { key: "caption_font_size", label: "Caption", token: "--font-size-caption", min: 11, max: 14, advanced: true },
] as const;

export type SizeKey = (typeof SIZE_FIELDS)[number]["key"];

export type Typography = Record<SizeKey, number> & {
  primary_font: FontKey;
  /** "same" follows the primary font. */
  heading_font: FontKey | "same";
  base_font_size: number;
  body_font_weight: number;
  heading_font_weight: number;
  heading_scale: HeadingScale;
  mobile_font_scale: MobileScale;
};

export const DEFAULT_TYPOGRAPHY: Typography = {
  primary_font: "inter",
  heading_font: "same",
  base_font_size: 16,
  body_font_weight: 400,
  heading_font_weight: 600,
  heading_scale: "normal",
  mobile_font_scale: "normal",
  page_title_font_size: 24,
  section_title_font_size: 16,
  card_title_font_size: 16,
  body_font_size: 16,
  small_font_size: 14,
  caption_font_size: 12,
  button_font_size: 14,
  input_font_size: 14,
  table_font_size: 14,
  sidebar_font_size: 14,
};

export const TYPOGRAPHY_KEYS = Object.keys(DEFAULT_TYPOGRAPHY) as (keyof Typography)[];

const font = (key: string) => FONTS.find((entry) => entry.key === key) ?? FONTS[0];

export function fontStack(key: string) {
  const { variable } = font(key);
  return variable ? `var(${variable}), ${FALLBACK_STACK}` : FALLBACK_STACK;
}

/** The weights a font ships, limited to the ones offered for body or heading text. */
export function weightsFor(key: string, allowed: readonly number[]) {
  const available = font(key).weights as readonly number[];
  return allowed.filter((weight) => available.includes(weight));
}

/** The supported weight closest to the one asked for. */
export function nearestWeight(key: string, allowed: readonly number[], wanted: number) {
  const options = weightsFor(key, allowed);
  return options.reduce((best, weight) => (Math.abs(weight - wanted) < Math.abs(best - wanted) ? weight : best), options[0] ?? 400);
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

/**
 * The typography variables. globals.css turns them into the text sizes, fonts
 * and weights every component uses, so nothing is set per page.
 *
 * On <html> the sizes are in rem: they follow the base size, and the mobile
 * scale on phones. The live preview cannot change the page's root size, so it
 * asks for `pixels`, with the base (and optionally the mobile scale) applied.
 */
export function typographyVariables(
  settings: Typography,
  preview?: { device: "desktop" | "mobile" },
): Record<string, string> {
  const base = clamp(settings.base_font_size, BASE_SIZE.min, BASE_SIZE.max, DEFAULT_TYPOGRAPHY.base_font_size);
  const mobile = MOBILE_SCALES[settings.mobile_font_scale] ?? 1;
  const primary = font(settings.primary_font).key;
  const heading = settings.heading_font === "same" ? primary : font(settings.heading_font).key;
  const factor = preview ? (base / 16) * (preview.device === "mobile" ? mobile : 1) : 1;

  const variables: Record<string, string> = {
    "--font-primary": fontStack(primary),
    "--font-heading-family": fontStack(heading),
    "--font-weight-body": String(nearestWeight(primary, BODY_WEIGHTS, Number(settings.body_font_weight) || 400)),
    "--font-weight-heading": String(nearestWeight(heading, HEADING_WEIGHTS, Number(settings.heading_font_weight) || 600)),
    "--heading-scale": String(HEADING_SCALES[settings.heading_scale] ?? 1),
  };
  for (const field of SIZE_FIELDS) {
    const size = clamp(settings[field.key], field.min, field.max, DEFAULT_TYPOGRAPHY[field.key]);
    variables[field.token] = preview ? `${Math.round(size * factor * 100) / 100}px` : `${size / 16}rem`;
  }
  if (preview) {
    // Page titles are a little smaller on phones (see globals.css).
    variables["--page-title-shrink"] = preview.device === "mobile" ? "0.84" : "1";
  } else {
    variables["--font-size-base"] = `${base}px`;
    variables["--mobile-font-scale"] = String(mobile);
  }
  return variables;
}
