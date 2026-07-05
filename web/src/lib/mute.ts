// The player's persisted mute preference. As of issue #43 this drives a real
// ambient audio bed in Play (web/public/audio/ambient.*); before that it was a
// designed-in-advance preference nothing audible read. Same client-side-only
// storage pattern as lib/connection.ts's passphrase.
//
// Issue #53: ambient music is now OFF by default — nothing plays unless the
// player turns it on with the mute button. The storage key is bumped to ".v2"
// so any prior "unmuted" preference is ignored and everyone starts muted; the
// absence of a stored value means muted (true), not unmuted.
const MUTE_KEY = "chronicle.muted.v2";

export function loadMuted(): boolean {
  try {
    // Default (no stored value) = muted. Only an explicit "false" unmutes.
    return localStorage.getItem(MUTE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveMuted(muted: boolean): void {
  localStorage.setItem(MUTE_KEY, String(muted));
}
