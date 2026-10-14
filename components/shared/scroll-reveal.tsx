import type { CSSProperties, ReactNode } from "react";

/**
 * Fades its content in with a small rise: when the page appears if it is on
 * screen, otherwise the first time it is scrolled into view. It only marks
 * the element; the animation is in globals.css and the observer is the single
 * script in the root layout (see lib/motion.ts).
 *
 * Page sections, tables and the cards of a `data-reveal-list` animate on
 * their own. Use this for anything else:
 *
 *   <ScrollReveal><StatsCard /></ScrollReveal>
 *   <ScrollReveal delay={100}><AttendanceChart /></ScrollReveal>
 *
 * Elements that scroll in together are staggered automatically, so `delay` is
 * rarely needed. When animations are off, or the visitor prefers reduced
 * motion, the content is simply there.
 */
export function ScrollReveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Extra wait in milliseconds. Keep it small. */
  delay?: number;
  className?: string;
}) {
  return (
    <div data-reveal="" className={className} style={delay ? ({ "--reveal-delay": `${Math.min(delay, 300)}ms` } as CSSProperties) : undefined}>
      {children}
    </div>
  );
}
