import { useEffect, useState } from "react";

// ADR-0021: the app styles everything with inline style objects and has no
// CSS-class system to hang @media rules on, so the single source of truth for
// "am I on a desktop-width screen" is this hook. 900px keeps portrait tablets
// on the mobile layout and sends landscape-tablet-and-up to the desktop layout.
export const DESKTOP_MIN_WIDTH = 900;

const QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

/** True when the viewport is at least DESKTOP_MIN_WIDTH wide, updating live as
 * the window is resized. SSR-safe: matchMedia may not exist (tests, non-browser
 * render), in which case it stays false — mobile is the safe default. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    // Sync once in case the width changed between the initial render and effect.
    setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
