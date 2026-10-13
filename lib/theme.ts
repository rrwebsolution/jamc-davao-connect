// Shared by the server (root layout) and the client (live preview in
// Appearance settings), so it must stay free of server-only imports.

export const COLOR_FIELDS = [
  { key: "primary_color", label: "Primary", hint: "Brand colour: active navigation, highlights, charts" },
  { key: "secondary_color", label: "Secondary", hint: "Soft surfaces such as secondary buttons and tags" },
  { key: "accent_color", label: "Accent", hint: "Emphasis: badges, trend indicators" },
  { key: "sidebar_background_color", label: "Sidebar background", hint: "" },
  { key: "sidebar_text_color", label: "Sidebar text", hint: "" },
  { key: "navbar_color", label: "Header / navbar", hint: "" },
  { key: "background_color", label: "Page background", hint: "" },
  { key: "card_color", label: "Card background", hint: "" },
  { key: "button_color", label: "Button", hint: "" },
  { key: "button_text_color", label: "Button text", hint: "" },
  { key: "link_color", label: "Link", hint: "" },
] as const;

export type ColorKey = (typeof COLOR_FIELDS)[number]["key"];
export type ThemeColors = Record<ColorKey, string>;
export type ThemeMode = "light" | "dark" | "system";

export type Branding = ThemeColors & {
  church_name: string;
  system_name: string;
  system_short_name: string;
  tagline: string;
  logo_path: string | null;
  /** Logo above the sign-in form in light mode. */
  login_logo_path: string | null;
  /** Logo above the sign-in form in dark mode. */
  login_logo_dark_path: string | null;
  favicon_path: string | null;
  login_background_path: string | null;
  /** Height of the church logo in the sidebar, in pixels (20-48). */
  logo_size: number;
  /** Height of the logo above the sign-in form, in pixels (32-160). */
  login_logo_size: number;
  default_theme: ThemeMode;
  allow_user_theme_override: boolean;
  updated_at: string | null;
};

export const DEFAULT_COLORS: ThemeColors = {
  primary_color: "#7C2D12",
  secondary_color: "#F3E7DA",
  accent_color: "#B45309",
  sidebar_background_color: "#431407",
  sidebar_text_color: "#FDF4E7",
  navbar_color: "#FFFFFF",
  background_color: "#FBF7F2",
  card_color: "#FFFFFF",
  button_color: "#7C2D12",
  button_text_color: "#FFFFFF",
  link_color: "#9A3412",
};

export const DEFAULT_BRANDING: Branding = {
  ...DEFAULT_COLORS,
  church_name: "JAMC-Davao",
  system_name: "JAMC Davao Connect",
  system_short_name: "JAMC Connect",
  tagline: "People. Groups. Care. Growth.",
  logo_path: null,
  login_logo_path: null,
  login_logo_dark_path: null,
  favicon_path: null,
  login_background_path: null,
  logo_size: 32,
  login_logo_size: 56,
  default_theme: "light",
  allow_user_theme_override: true,
  updated_at: null,
};

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function luminance(hex: string) {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string) {
  if (!HEX_COLOR.test(a) || !HEX_COLOR.test(b)) {
    return 1;
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Dark or light text, whichever reads better on the given background. */
export function readableOn(background: string) {
  const ink = "#1C1917";
  const paper = "#FFFFFF";
  return contrastRatio(background, ink) >= contrastRatio(background, paper) ? ink : paper;
}

/**
 * The raw brand variables. globals.css maps them onto the design tokens
 * (--primary, --sidebar, --button, ...) for both light and dark mode, so
 * components never reference a hex value.
 */
export function brandVariables(colors: ThemeColors): Record<string, string> {
  const safe = (key: ColorKey) => (HEX_COLOR.test(colors[key]) ? colors[key] : DEFAULT_COLORS[key]);
  return {
    "--brand-primary": safe("primary_color"),
    "--brand-primary-fg": readableOn(safe("primary_color")),
    "--brand-secondary": safe("secondary_color"),
    "--brand-secondary-fg": readableOn(safe("secondary_color")),
    "--brand-accent": safe("accent_color"),
    "--brand-accent-fg": readableOn(safe("accent_color")),
    "--brand-sidebar": safe("sidebar_background_color"),
    "--brand-sidebar-fg": safe("sidebar_text_color"),
    "--brand-navbar": safe("navbar_color"),
    "--brand-navbar-fg": readableOn(safe("navbar_color")),
    "--brand-background": safe("background_color"),
    "--brand-background-fg": readableOn(safe("background_color")),
    "--brand-card": safe("card_color"),
    "--brand-card-fg": readableOn(safe("card_color")),
    "--brand-button": safe("button_color"),
    "--brand-button-fg": safe("button_text_color"),
    "--brand-link": safe("link_color"),
  };
}
