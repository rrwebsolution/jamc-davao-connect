import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { brandingAssetUrl, getBranding } from "@/lib/branding";
import { readableOn } from "@/lib/theme";

const SIZES = new Set(["180", "192", "512"]);

/**
 * App icon for the home screen, drawn from the branding settings: the church
 * logo on the sidebar colour, or the system's initial when no logo is set.
 * `?maskable=1` leaves the extra margin that Android's icon shapes crop into.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/pwa-icon/[size]">) {
  const { size: raw } = await params;
  const size = SIZES.has(raw) ? Number(raw) : 192;
  const maskable = request.nextUrl.searchParams.get("maskable") === "1";

  const branding = await getBranding();
  const background = branding.sidebar_background_color;
  const logo = brandingAssetUrl(branding.logo_path);
  const inner = Math.round(size * (maskable ? 0.56 : 0.72));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background,
          color: readableOn(background),
          fontSize: Math.round(size * 0.5),
          fontWeight: 700,
        }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" width={inner} height={inner} style={{ objectFit: "contain" }} />
        ) : (
          branding.system_short_name.slice(0, 1).toUpperCase()
        )}
      </div>
    ),
    { width: size, height: size },
  );
}
