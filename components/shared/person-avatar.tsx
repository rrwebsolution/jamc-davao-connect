import { cn } from "cn";
import { initials } from "@/lib/format";

/** Photo if there is one, otherwise initials. Plain <img>: the URLs are short-lived signed links. */
export function PersonAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xs font-semibold text-secondary-foreground",
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
    </span>
  );
}

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/12 text-info",
  brand: "bg-highlight/12 text-highlight",
} as const;

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex h-5.5 items-center rounded-full px-2.5 text-xs leading-none font-medium whitespace-nowrap", TONES[tone])}>
      {children}
    </span>
  );
}
