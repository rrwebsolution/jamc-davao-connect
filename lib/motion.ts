// Motion settings and the one small script behind scroll reveal. Shared by the
// server (root layout) and the client (Appearance settings), so it must stay
// free of server-only imports.

export type MotionLevel = "off" | "subtle" | "normal";

export type MotionSettings = {
  /** Master switch. Off behaves like the "off" level. */
  animations_enabled: boolean;
  animation_level: MotionLevel;
  /** Content fades in as it scrolls into view. */
  scroll_reveal_enabled: boolean;
};

export const DEFAULT_MOTION: MotionSettings = {
  animations_enabled: true,
  animation_level: "subtle",
  scroll_reveal_enabled: true,
};

/** The level actually in force. globals.css reads it from <html data-motion>. */
export function motionLevel(settings: MotionSettings): MotionLevel {
  if (!settings.animations_enabled) return "off";
  return settings.animation_level === "normal" || settings.animation_level === "off" ? settings.animation_level : "subtle";
}

export function scrollRevealOn(settings: MotionSettings) {
  return settings.scroll_reveal_enabled && motionLevel(settings) !== "off";
}

/**
 * What animates in. globals.css gives the same set its entrance animation, so
 * the two must match:
 *   [data-reveal]                    anything wrapped in <ScrollReveal>
 *   [data-reveal-list] > *           each card of a list
 *   [data-slot="table-container"]    a table as a whole, never its rows
 *   [data-page] section              the sections of a page
 */
export const REVEAL_SELECTOR = '[data-reveal],[data-reveal-list]>*,[data-slot="table-container"],[data-page] section';

/**
 * Scroll reveal, in one place, with no code on the pages themselves.
 *
 * Content that is on screen when it appears is animated by CSS alone (see
 * globals.css). This script handles the rest: content that was below the
 * screen and is scrolled to later.
 *
 * - One IntersectionObserver; no scroll listener. An element is animated the
 *   first time it enters the viewport and then forgotten, so it never replays.
 * - Elements entering together get a small stagger, capped so a long list
 *   never makes anyone wait.
 * - A MutationObserver picks up content that arrives later (streamed pages,
 *   client navigation, new rows).
 * - It uses the Web Animations API and changes no attributes or styles, so
 *   nothing is ever left hidden: without JavaScript, or with a reduced-motion
 *   preference, the content is simply there.
 * - Only opacity and translate are animated.
 */
export const REVEAL_SCRIPT = `(function(){try{if(!("IntersectionObserver"in window)||!("MutationObserver"in window)||!Element.prototype.animate||matchMedia("(prefers-reduced-motion: reduce)").matches)return;var d=document.documentElement,S=${JSON.stringify(REVEAL_SELECTOR)},watched=new WeakSet(),reported=new WeakSet();function token(n,f){var v=parseFloat(getComputedStyle(d).getPropertyValue(n));return isNaN(v)?f:v}var io=new IntersectionObserver(function(es){var n=0,dur,dist,step;for(var i=0;i<es.length;i++){var e=es[i],el=e.target;if(!reported.has(el)){reported.add(el);if(e.isIntersecting)io.unobserve(el);continue}if(!e.isIntersecting)continue;io.unobserve(el);if(d.getAttribute("data-motion")==="off"||el.closest("[data-reveal-instant]"))continue;if(dur===undefined){dur=token("--motion-duration-slow",360);dist=token("--motion-distance-normal",12);step=token("--motion-stagger",45)}el.animate([{opacity:0,translate:"0 "+dist+"px"},{opacity:1,translate:"0 0"}],{duration:dur,delay:Math.min(n,6)*step,easing:"cubic-bezier(0.22,0.61,0.36,1)",fill:"backwards"});n++}});function watch(el){if(!watched.has(el)){watched.add(el);io.observe(el)}}function scan(r){if(!r||r.nodeType!==1)return;if(r.matches(S))watch(r);var l=r.querySelectorAll(S);for(var i=0;i<l.length;i++)watch(l[i])}new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var a=ms[i].addedNodes;for(var j=0;j<a.length;j++)scan(a[j])}}).observe(d,{childList:true,subtree:true});scan(d)}catch(e){}})();`;
