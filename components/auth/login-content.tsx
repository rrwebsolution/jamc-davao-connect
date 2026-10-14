import type { LoginContent } from "@/lib/theme";

// The welcome message and Bible verse of the login page. Used by the page
// itself and by the live preview in Appearance settings, so both always match.
// Fonts come from the typography settings; colours from whatever they sit on.

/** What should actually be shown: hidden or empty parts are left out entirely. */
export function visibleLoginContent(content: LoginContent) {
  const message = content.show_login_welcome_message ? content.login_welcome_message.trim() : "";
  // The page adds the quotation marks; drop any that were typed in.
  const verse = content.show_login_bible_verse ? content.login_bible_verse.trim().replace(/^["“”']+|["“”']+$/g, "") : "";
  return { message, verse, reference: verse ? content.login_bible_verse_reference.trim() : "" };
}

export function LoginWelcome({ message, className = "" }: { message: string; className?: string }) {
  return message ? <p className={`whitespace-pre-line leading-relaxed ${className}`}>{message}</p> : null;
}

export function LoginVerse({ verse, reference, className = "" }: { verse: string; reference: string; className?: string }) {
  if (!verse) return null;
  return (
    <figure className={className}>
      <blockquote className="whitespace-pre-line italic leading-relaxed">“{verse}”</blockquote>
      {reference ? <figcaption className="mt-2 text-[0.92em] font-medium not-italic">— {reference}</figcaption> : null}
    </figure>
  );
}
