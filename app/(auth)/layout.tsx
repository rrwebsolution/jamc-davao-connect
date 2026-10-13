import Image from "next/image";
import { CurrentYear } from "@/components/auth/current-year";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { SetupNotice } from "@/components/app/setup-notice";
import { brandingAssetUrl, getBranding } from "@/lib/branding";
import { isSupabaseConfigured } from "@/lib/env";

// Everything here comes from Appearance & Branding settings (cached, and the
// only thing this route reads before sign-in). The two short lines of welcome
// copy and the verse are the page's own text.
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  if (!isSupabaseConfigured) {
    return <SetupNotice />;
  }

  const branding = await getBranding();
  const churchLogo = brandingAssetUrl(branding.logo_path);
  // Above the sign-in form: one logo for a light page, one for a dark page.
  const lightLogo = brandingAssetUrl(branding.login_logo_path);
  const darkLogo = brandingAssetUrl(branding.login_logo_dark_path) ?? churchLogo ?? lightLogo;
  const background = brandingAssetUrl(branding.login_background_path);
  const initial = branding.system_short_name.slice(0, 1).toUpperCase();

  // With a photo the text sits on a dark overlay; without one the panel uses
  // the sidebar colours, which the Super Admin has already paired for contrast.
  const panelTone = background ? "bg-neutral-900 text-white" : "bg-sidebar text-sidebar-foreground";
  const backdrop = (
    <>
      {background ? (
        <Image src={background} alt="" fill priority sizes="(min-width: 1024px) 55vw, 100vw" className="object-cover" />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 0% 0%, color-mix(in oklch, var(--brand-primary) 55%, transparent) 0%, transparent 60%), radial-gradient(90% 80% at 100% 100%, color-mix(in oklch, var(--brand-accent) 38%, transparent) 0%, transparent 65%)",
          }}
          aria-hidden
        />
      )}
      {background ? (
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, color-mix(in oklch, var(--brand-primary) 30%, rgb(0 0 0 / 0.86)) 0%, rgb(0 0 0 / 0.42) 45%, rgb(0 0 0 / 0.2) 100%)",
          }}
          aria-hidden
        />
      ) : null}
    </>
  );

  // The church logo keeps the proportion chosen for the sidebar, scaled up for this page.
  const mark = (logo: string | null, size: string, scale = 1.75) =>
    logo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt={`${branding.church_name} logo`}
        style={{ height: Math.round(branding.logo_size * scale) }}
        className="w-auto max-w-[60%] shrink-0 object-contain"
      />
    ) : (
      <span className={`${size} flex aspect-square items-center justify-center rounded-2xl bg-current/10 text-xl font-semibold ring-1 ring-current/20`}>
        {initial}
      </span>
    );

  return (
    <div className="grid min-h-dvh w-full lg:grid-cols-[55fr_45fr]">
      {/* Desktop: full-height welcome panel. */}
      <aside className={`relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between ${panelTone}`}>
        {background ? (
          <>
            {/* A blurred, darkened copy fills the panel behind the picture. */}
            <Image src={background} alt="" fill sizes="20vw" className="scale-110 object-cover blur-2xl" aria-hidden />
            <div className="absolute inset-0 bg-black/55" aria-hidden />
          </>
        ) : (
          backdrop
        )}
        <p className="relative px-10 pt-10 text-sm font-medium tracking-wide opacity-85 xl:px-14 xl:pt-12">{branding.church_name}</p>

        {/* The uploaded picture, shown whole: scaled to fit, never cropped. */}
        {background ? (
          <div className="relative mx-10 my-6 min-h-40 flex-1 xl:mx-14">
            <Image src={background} alt="" fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="object-contain drop-shadow-xl" />
          </div>
        ) : null}

        <div className="relative animate-in fade-in px-10 pb-10 duration-500 motion-reduce:animate-none xl:px-14 xl:pb-12">
          <div className={background ? "flex items-center gap-4" : undefined}>
            {mark(churchLogo, background ? "h-12" : "h-14")}
            <div className={background ? "min-w-0" : "mt-6"}>
              <h1 className={`font-semibold tracking-tight ${background ? "text-3xl xl:text-4xl" : "text-4xl xl:text-5xl"}`}>
                {branding.system_name}
              </h1>
              {branding.tagline ? (
                <p className={background ? "mt-1 text-base opacity-90" : "mt-3 text-lg opacity-90 xl:text-xl"}>{branding.tagline}</p>
              ) : null}
            </div>
          </div>
          <p className={`max-w-md text-base leading-relaxed opacity-80 ${background ? "mt-5" : "mt-6"}`}>
            Connecting people. Strengthening discipleship. Caring for every person.
          </p>

          <figure className={`max-w-md border-l border-current/25 pl-4 text-sm opacity-70 ${background ? "mt-5" : "mt-12"}`}>
            <blockquote className="italic leading-relaxed">
              “Let us consider how we may spur one another on toward love and good deeds.”
            </blockquote>
            <figcaption className="mt-1.5 not-italic">Hebrews 10:24</figcaption>
          </figure>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col bg-background lg:min-h-0">
        {/* Phones and tablets: a compact banner instead of the big panel. */}
        <header className={`relative overflow-hidden lg:hidden ${panelTone}`}>
          {backdrop}
          <div className="relative flex items-center gap-3.5 px-6 py-7 sm:px-10 sm:py-9">
            {mark(churchLogo, "h-12", 1.5)}
            <div className="min-w-0">
              <p className="truncate text-xl font-semibold tracking-tight">{branding.system_name}</p>
              {branding.tagline ? <p className="truncate text-sm opacity-85">{branding.tagline}</p> : null}
            </div>
          </div>
        </header>

        {branding.allow_user_theme_override ? (
          <div className="hidden justify-end px-6 pt-4 text-muted-foreground lg:flex">
            <ThemeToggle />
          </div>
        ) : null}

        <main className="flex flex-1 items-start justify-center px-6 py-8 sm:px-10 lg:items-center lg:py-10">
          <div className="w-full max-w-[26.5rem] animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
            {/* Light mode */}
            {lightLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lightLogo}
                alt=""
                style={{ height: branding.login_logo_size }}
                className="mb-7 hidden w-auto max-w-full object-contain lg:block dark:lg:hidden"
              />
            ) : churchLogo ? (
              // No light-mode logo yet: the church logo is made for dark surfaces,
              // so it is shown on a dark tile rather than vanishing into the page.
              <span className="mb-7 hidden rounded-2xl bg-sidebar px-5 py-4 lg:inline-flex dark:lg:hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={churchLogo} alt="" style={{ height: branding.login_logo_size }} className="w-auto max-w-full object-contain" />
              </span>
            ) : null}
            {/* Dark mode */}
            {darkLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={darkLogo}
                alt=""
                style={{ height: branding.login_logo_size }}
                className="mb-7 hidden w-auto max-w-full object-contain dark:lg:block"
              />
            ) : null}
            {children}
          </div>
        </main>

        <footer className="px-6 pb-6 text-center text-xs leading-relaxed text-muted-foreground sm:px-10">
          <p>
            © <CurrentYear /> {branding.church_name}
          </p>
          <p>{branding.system_name}</p>
        </footer>
      </div>
    </div>
  );
}
