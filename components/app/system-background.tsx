import type { CSSProperties } from "react";
import { backgroundVariables, type SystemBackgroundSettings } from "@/lib/background";

/**
 * The system background: a picture that stays put while the page scrolls over
 * it. It is its own fixed layer behind the whole application shell (not a
 * `background-attachment: fixed`, which phones handle badly), with a colour
 * overlay on top to keep the content readable.
 *
 * Nothing here moves or animates, and it is rendered by the app layout, so it
 * stays mounted while pages change. It is drawn as a CSS background, so a
 * missing file simply shows the normal background colour, never a broken
 * image.
 *
 * `contained` draws it inside its parent instead, for the settings preview.
 */
export function SystemBackground({
  imageUrl,
  settings,
  contained = false,
  mode,
}: {
  imageUrl: string;
  settings: SystemBackgroundSettings;
  contained?: boolean;
  /** Preview only: force the light or dark overlay. */
  mode?: "light" | "dark";
}) {
  return (
    <div
      aria-hidden
      className={contained ? "system-background system-background-contained" : "system-background"}
      style={backgroundVariables(settings, mode) as CSSProperties}
    >
      <div className="system-background-image" style={{ backgroundImage: `url(${JSON.stringify(imageUrl)})` }} />
      <div className="system-background-overlay" />
    </div>
  );
}
