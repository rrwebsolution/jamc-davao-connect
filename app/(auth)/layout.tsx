import { Quote } from "lucide-react";
import { CurrentYear } from "@/components/auth/current-year";
import { LoginVerse, LoginWelcome, visibleLoginContent } from "@/components/auth/login-content";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { SetupNotice } from "@/components/app/setup-notice";
import { brandingAssetUrl, getBranding } from "@/lib/branding";
import { isSupabaseConfigured } from "@/lib/env";

// Everything here comes from Appearance & Branding settings (cached, and the
// only thing this route reads before sign-in), including the welcome message
// and the Bible verse.
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
  // Hidden or empty parts are left out, so the layout closes up around them.
  const content = visibleLoginContent(branding);

  // The welcome side always uses the sidebar colours, which the Super Admin
  // has already paired for contrast. An uploaded picture only tints it (a
  // soft, blurred wash), so the text stays readable whatever the picture is.
  const panel = "bg-sidebar text-sidebar-foreground";
  const atmosphere = (
    <>
      {background ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={background} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-25 blur-3xl saturate-150" />
      ) : null}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(110% 80% at 0% 0%, color-mix(in oklch, var(--brand-primary) 60%, transparent) 0%, transparent 60%), radial-gradient(90% 70% at 100% 100%, color-mix(in oklch, var(--brand-accent) 42%, transparent) 0%, transparent 62%)",
        }}
        aria-hidden
      />
      {/* A faint dot grid that fades out, for texture. */}
      <div
        className="absolute inset-0 opacity-[0.09]"
        style={{
          backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "linear-gradient(to bottom, black, transparent 75%)",
        }}
        aria-hidden
      />
    </>
  );

  // The church logo keeps the proportion chosen for the sidebar, scaled for this page.
  const mark = (size: string, scale: number) =>
    churchLogo ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={churchLogo}
        alt={`${branding.church_name} logo`}
        style={{ height: Math.round(branding.logo_size * scale) }}
        className="w-auto max-w-[60%] shrink-0 object-contain"
      />
    ) : (
      <span className={`${size} flex aspect-square shrink-0 items-center justify-center rounded-2xl bg-current/10 text-lg font-semibold ring-1 ring-current/20`}>
        {initial}
      </span>
    );

  return (
    <div className="grid grid-cols-1 min-h-dvh w-full lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
      {/* Desktop: the welcome side. It stays in view while a long form scrolls. */}
      <aside className={`relative hidden lg:block ${panel}`}>
        <div className="sticky top-0 flex h-dvh flex-col overflow-hidden">
          {atmosphere}

          <div className="relative flex items-center gap-3 px-10 pt-9 xl:px-14 xl:pt-11">
            {mark("h-10", 1.25)}
            <p className="truncate text-sm font-medium tracking-wide opacity-85">{branding.church_name}</p>
          </div>

          {/* The uploaded picture, shown whole in a frame: scaled to fit, never cropped. */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-10 py-7 xl:px-14">
            {background ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={background}
                alt=""
                className="max-h-full min-h-0 max-w-full rounded-2xl object-contain shadow-2xl shadow-black/40 ring-1 ring-white/20 animate-in fade-in zoom-in-95 duration-700 motion-reduce:animate-none [@media(max-height:640px)]:hidden"
              />
            ) : null}
          </div>

          <div className="relative px-10 pb-10 animate-in fade-in slide-in-from-bottom-3 duration-700 motion-reduce:animate-none xl:px-14 xl:pb-12">
            {branding.tagline ? (
              <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] opacity-75">
                <span className="h-px w-8 bg-current opacity-60" aria-hidden />
                {branding.tagline}
              </p>
            ) : null}
            <h1 data-type="display" className="mt-3 text-4xl leading-[1.1] tracking-tight text-balance xl:text-5xl">
              {branding.system_name}
            </h1>
            <LoginWelcome message={content.message} className="mt-4 max-w-lg text-base opacity-80 xl:text-lg" />

            {content.verse ? (
              <div className="mt-7 flex max-w-lg gap-3.5 rounded-2xl bg-current/[0.07] p-4 ring-1 ring-current/10 backdrop-blur-sm xl:p-5">
                <Quote className="mt-0.5 size-5 shrink-0 opacity-50" aria-hidden />
                <LoginVerse verse={content.verse} reference={content.reference} className="text-sm opacity-90" />
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <div className="relative flex min-h-dvh flex-col bg-background lg:min-h-0">
        {/* Desktop: two soft glows in the brand colours behind the form. */}
        <div className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block" aria-hidden>
          <div className="absolute -right-28 -top-28 size-96 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-36 -left-20 size-96 rounded-full bg-highlight/10 blur-3xl" />
        </div>

        {/* Phones and tablets: a hero in the brand colours; the form rises over it as a sheet. */}
        <header className={`relative overflow-hidden lg:hidden ${panel}`}>
          {atmosphere}
          <div className="relative flex flex-col items-center px-6 pb-14 pt-10 text-center sm:px-10 sm:pt-12">
            {mark("h-14", 1.75)}
            <p data-type="display" className="mt-4 text-2xl leading-tight tracking-tight text-balance sm:text-3xl">
              {branding.system_name}
            </p>
            {branding.tagline ? (
              <p className="mt-1.5 text-xs font-semibold uppercase tracking-[0.18em] opacity-75">{branding.tagline}</p>
            ) : null}
            <LoginWelcome message={content.message} className="mt-3 max-w-sm text-sm opacity-85" />
          </div>
        </header>

        {branding.allow_user_theme_override ? (
          <div className="relative z-20 hidden justify-end px-6 pt-4 text-muted-foreground lg:flex">
            <ThemeToggle />
          </div>
        ) : null}

        <main className="relative z-10 -mt-7 flex flex-1 items-start justify-center rounded-t-[1.75rem] bg-background px-6 pb-8 pt-8 shadow-[0_-12px_30px_-18px_rgb(0_0_0/0.45)] sm:px-10 lg:mt-0 lg:items-center lg:rounded-none lg:bg-transparent lg:py-10 lg:shadow-none">
          <div className="w-full max-w-[26.5rem] animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none lg:max-w-[30rem] lg:rounded-3xl lg:border lg:bg-card lg:p-9 lg:shadow-xl lg:shadow-black/5 xl:p-10">
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
              <span className="mb-7 hidden rounded-2xl bg-sidebar px-4 py-3 shadow-md ring-1 ring-black/5 lg:inline-flex dark:lg:hidden">
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

        {/* Phones and tablets: the verse comes after the form, which stays the focus. */}
        {content.verse ? (
          <div className="relative z-10 bg-background px-6 pb-6 sm:px-10 lg:hidden">
            <div className="mx-auto flex max-w-[26.5rem] gap-3 rounded-2xl bg-muted/70 p-4 text-muted-foreground">
              <Quote className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
              <LoginVerse verse={content.verse} reference={content.reference} className="text-sm" />
            </div>
          </div>
        ) : null}

        <footer className="relative z-10 bg-background px-6 pb-6 text-center text-xs leading-relaxed text-muted-foreground sm:px-10 lg:bg-transparent">
          <p>
            © <CurrentYear /> {branding.church_name}
          </p>
          <p>{branding.system_name}</p>
        </footer>
      </div>
    </div>
  );
}
