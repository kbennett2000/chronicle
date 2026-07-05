// Per docs/design/handoff-2026-07/README.md: "adaptive music is planned
// but not yet built — design it in now." A real, persisted preference
// today even though nothing audible reads it yet, same client-side-only
// storage pattern as lib/connection.ts's passphrase.
const MUTE_KEY = "chronicle.muted";

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, String(muted));
}
