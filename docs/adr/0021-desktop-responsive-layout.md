# ADR-0021: Desktop responsive layout

## Status
Accepted

## Context
Issue #85: Chronicle's web UI was built mobile-first (the primary audience is
on phones) and has **no desktop handling at all** — no `@media` queries
anywhere in `web/src`, no max-width container, a phone-oriented viewport meta,
and every screen is a full-bleed single vertical column (`.screen` in
`web/src/theme.css` = `position:absolute; inset:0; flex-column`). On a desktop
monitor prose lines, forms, and the parchment story area stretch edge-to-edge,
and the Play screen's Self/Folk/Quest/Views panels open in a 90%-height
slide-up bottom sheet (`web/src/components/BottomSheet.tsx`) — a phone ergonomic
that wastes the horizontal space a desktop has. Nothing is functionally broken;
it just "feels like a mobile design on a big screen."

Two forces constrain the response:

1. **The design doc defers the *final* desktop UX** — §7 envisions a freely
   resizable/movable/**dockable** panel layout (Golden Layout / Dockview /
   react-mosaic) with saved layouts, and §10/§13 flag that (and deep UX polish
   generally) as **future "Claude Design handoff"** work, *not* a Claude Code
   slice. Building that heavy system now would pre-empt the handoff and add a
   dependency the design doc explicitly wants Design to choose.
2. **Mobile is the primary target and must not regress** — whatever desktop
   gets, the phone experience stays exactly as it is today.

## Decision
Ship a pragmatic **responsive-columns** desktop layout — first-class for
desktop, but deliberately *not* the dockable-panel system. That heavier layout
stays deferred to the Design handoff (force #1).

### Mechanism: a JS breakpoint hook, not CSS classes
The app styles everything with inline `style={{}}` objects and has no
CSS-class system to hang `@media` rules on, so the single source of truth is a
tiny hook, `web/src/lib/useIsDesktop.ts`, wrapping
`matchMedia("(min-width: 900px)")` with a `change` listener and an SSR-safe
default. Every screen reads it to pick a layout. A few real `@media` rules are
added to `theme.css` only where a class already exists and benefits (e.g. a
`.sheet-panel` max-width fallback). 900px keeps portrait tablets on the mobile
layout and sends landscape-tablet-and-up to desktop.

### What changes at the desktop breakpoint
- **Home / Settings / NewCharacter:** the full-bleed scroll bodies get a
  centered max-width column (`margin:"0 auto"`), mirroring the existing Auth
  screen pattern. Content stops stretching; nothing else changes.
- **Play:** the vertical band stack becomes a **two-column** layout — a
  centered, width-capped story+input column on the left, and a **persistent
  docked side panel** on the right whose Self/Folk/Quest/Views selector replaces
  the bottom tab bar. **No bottom sheet on desktop.** The panel *components* and
  the `openTab` state are reused verbatim; only the container differs by
  breakpoint.
- The hard-coded `54px`/`66px` top insets (phone status-bar standins) shrink at
  desktop width.

### Testing posture
`playwright.config.ts` sets no viewport, so the suite ran at Playwright's
1280×720 (desktop) default. The existing specs assume the mobile bottom-sheet
interaction, so the default `use.viewport` is pinned to a phone size to keep
them testing the mobile layout, and a **second Playwright project** with a
desktop viewport covers the new desktop behavior.

## Consequences
- Desktop users get readable columns and a persistent panel instead of a
  stretched phone UI, with **no new runtime dependency**.
- Mobile is untouched — same components, same bottom sheet, same viewport-pinned
  e2e coverage.
- Layout branches on a JS hook rather than pure CSS. That's the pragmatic cost
  of an all-inline-styles codebase; if a future slice migrates hotspots to CSS
  classes, the media queries can move with them.
- This is **not** the design doc §7 dockable layout. That, plus saved layouts
  and the broader UX pass, remain the Design handoff's to build. This ADR is the
  interim "make desktop first-class without over-building" step, and is the
  desktop shell that issue #67's full character-sheet view (ADR-0022) renders
  into.
