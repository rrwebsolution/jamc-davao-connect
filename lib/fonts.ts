import {
  DM_Sans,
  Geist_Mono,
  Inter,
  Lato,
  Manrope,
  Montserrat,
  Nunito,
  Open_Sans,
  Poppins,
  Roboto,
  Source_Sans_3,
} from "next/font/google";

// The fonts offered in Appearance → Typography (see FONTS in lib/typography.ts).
// next/font downloads them at build time and serves them from this site, so
// browsers never contact Google. Each is exposed as a CSS variable and only
// downloaded by the browser when some text actually uses it. None is
// preloaded: which one is in use is a setting, not something known at build.
// (next/font needs its options written out literally for each font.)

const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-inter" });
const roboto = Roboto({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-roboto" });
const openSans = Open_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-open-sans" });
const lato = Lato({ subsets: ["latin"], display: "swap", preload: false, weight: ["300", "400", "700"], variable: "--font-lato" });
const poppins = Poppins({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
});
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-montserrat" });
const nunito = Nunito({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-nunito" });
const sourceSans3 = Source_Sans_3({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-source-sans-3" });
const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-dm-sans" });
const manrope = Manrope({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-manrope" });
const geistMono = Geist_Mono({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-geist-mono" });

/** Class names that define every font variable; applied once, on <html>. */
export const fontVariables = [inter, roboto, openSans, lato, poppins, montserrat, nunito, sourceSans3, dmSans, manrope, geistMono]
  .map((font) => font.variable)
  .join(" ");
