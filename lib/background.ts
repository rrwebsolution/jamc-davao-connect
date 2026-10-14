// The system background image: its settings and the CSS variables they
// become. Shared by the server (app layout) and the client (live preview in
// Appearance settings), so it must stay free of server-only imports.

export const BACKGROUND_POSITIONS = [
  { value: "center", label: "Center", css: "center" },
  { value: "top", label: "Top", css: "center top" },
  { value: "bottom", label: "Bottom", css: "center bottom" },
  { value: "left", label: "Left", css: "left center" },
  { value: "right", label: "Right", css: "right center" },
  { value: "top_left", label: "Top left", css: "left top" },
  { value: "top_right", label: "Top right", css: "right top" },
  { value: "bottom_left", label: "Bottom left", css: "left bottom" },
  { value: "bottom_right", label: "Bottom right", css: "right bottom" },
] as const;

export const BACKGROUND_SIZES = [
  { value: "cover", label: "Cover (fill the screen, recommended)" },
  { value: "contain", label: "Contain (show the whole picture)" },
  { value: "auto", label: "Auto (the picture's own size)" },
] as const;

export type BackgroundPosition = (typeof BACKGROUND_POSITIONS)[number]["value"];
export type BackgroundSize = (typeof BACKGROUND_SIZES)[number]["value"];
export const BACKGROUND_POSITION_VALUES = BACKGROUND_POSITIONS.map((item) => item.value) as [BackgroundPosition, ...BackgroundPosition[]];
export const BACKGROUND_SIZE_VALUES = BACKGROUND_SIZES.map((item) => item.value) as [BackgroundSize, ...BackgroundSize[]];

/** Limits shared by the form, the validation and (as CHECK constraints) the database. */
export const BACKGROUND_LIMITS = {
  background_overlay_opacity_light: { min: 0, max: 100 },
  background_overlay_opacity_dark: { min: 0, max: 100 },
  background_blur: { min: 0, max: 10 },
  background_brightness: { min: 50, max: 120 },
  sidebar_opacity: { min: 70, max: 100 },
  navbar_opacity: { min: 70, max: 100 },
} as const;

export type SystemBackgroundSettings = {
  /** Path of the picture in the public `branding` bucket. Separate from the login background. */
  system_background_path: string | null;
  /** Off shows the plain background colour without having to remove the picture. */
  system_background_enabled: boolean;
  background_size: BackgroundSize;
  background_position: BackgroundPosition;
  background_overlay_enabled: boolean;
  background_overlay_color_light: string;
  background_overlay_color_dark: string;
  background_overlay_opacity_light: number;
  background_overlay_opacity_dark: number;
  /** Pixels, 0-10. Applied to the picture only, never to the content. */
  background_blur: number;
  /** Percent, 50-120. */
  background_brightness: number;
  card_background_style: "solid" | "translucent";
  /** Percent, 70-100. */
  sidebar_opacity: number;
  navbar_opacity: number;
};

/** Everything except the picture itself: what "Reset background settings" restores. */
export const BACKGROUND_RESET: Omit<SystemBackgroundSettings, "system_background_path"> = {
  system_background_enabled: false,
  background_size: "cover",
  background_position: "center",
  background_overlay_enabled: true,
  background_overlay_color_light: "#FFFFFF",
  background_overlay_color_dark: "#000000",
  background_overlay_opacity_light: 75,
  background_overlay_opacity_dark: 65,
  background_blur: 0,
  background_brightness: 100,
  card_background_style: "solid",
  sidebar_opacity: 100,
  navbar_opacity: 100,
};

export const DEFAULT_BACKGROUND: SystemBackgroundSettings = { ...BACKGROUND_RESET, system_background_path: null };

/** The picture is shown only when it is switched on and there is one. */
export function backgroundActive(settings: SystemBackgroundSettings) {
  return settings.system_background_enabled && Boolean(settings.system_background_path);
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const within = (value: unknown, limit: { min: number; max: number }, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(limit.max, Math.max(limit.min, Math.round(number))) : fallback;
};

function overlay(color: string, opacity: number, fallback: string, enabled: boolean) {
  if (!enabled) return "transparent";
  const hex = HEX.test(color) ? color : fallback;
  const channel = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  return `rgb(${channel(1)} ${channel(3)} ${channel(5)} / ${within(opacity, { min: 0, max: 100 }, 70) / 100})`;
}

/**
 * Variables for the fixed background layer (see globals.css). `mode` forces
 * the light or dark overlay, for the settings preview; without it the layer
 * follows the page's own theme.
 */
export function backgroundVariables(settings: SystemBackgroundSettings, mode?: "light" | "dark"): Record<string, string> {
  const blur = within(settings.background_blur, BACKGROUND_LIMITS.background_blur, 0);
  const brightness = within(settings.background_brightness, BACKGROUND_LIMITS.background_brightness, 100);
  const filters = [blur > 0 ? `blur(${blur}px)` : "", brightness !== 100 ? `brightness(${brightness}%)` : ""].filter(Boolean);
  const light = overlay(settings.background_overlay_color_light, settings.background_overlay_opacity_light, "#FFFFFF", settings.background_overlay_enabled);
  const dark = overlay(settings.background_overlay_color_dark, settings.background_overlay_opacity_dark, "#000000", settings.background_overlay_enabled);
  return {
    "--sysbg-size": BACKGROUND_SIZES.some((item) => item.value === settings.background_size) ? settings.background_size : "cover",
    "--sysbg-position": BACKGROUND_POSITIONS.find((item) => item.value === settings.background_position)?.css ?? "center",
    "--sysbg-filter": filters.join(" ") || "none",
    // A blurred picture fades at its edges; let it run past the screen so they never show.
    "--sysbg-bleed": `${blur * 2}px`,
    "--sysbg-overlay-light": mode === "dark" ? dark : light,
    "--sysbg-overlay-dark": mode === "light" ? light : dark,
  };
}

/** Variables for the shell around the content: how see-through the sidebar and navbar are. */
export function surfaceVariables(settings: SystemBackgroundSettings): Record<string, string> {
  return {
    "--sysbg-sidebar-alpha": `${within(settings.sidebar_opacity, BACKGROUND_LIMITS.sidebar_opacity, 100)}%`,
    "--sysbg-navbar-alpha": `${within(settings.navbar_opacity, BACKGROUND_LIMITS.navbar_opacity, 100)}%`,
  };
}
