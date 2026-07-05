// The player's persisted mute preference. As of issue #43 this drives a real
// ambient audio bed in Play (web/public/audio/ambient.*); before that it was a
// designed-in-advance preference nothing audible read. Same client-side-only
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
