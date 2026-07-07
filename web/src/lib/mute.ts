// The player's persisted mute preference for background music (ADR-0020).
// Client-side only, same storage pattern as lib/connection.ts.
//
// Music is opt-in via a separate "enable music" account setting; the mute button
// only appears once music is enabled. So the sensible default here is UNMUTED —
// enabling music should actually play it, and the mute button silences it. The
// key is bumped to .v3 so anyone carrying the old default-muted (.v2) value
// starts fresh: with music now explicitly enabled, they expect it to play.
const MUTE_KEY = "chronicle.muted.v3";

export function loadMuted(): boolean {
  try {
    // Default (no stored value) = unmuted. Only an explicit "true" mutes.
    return localStorage.getItem(MUTE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, String(muted));
}
