// Issue #57: the player's last-chosen model, remembered client-side so a new
// game defaults to it instead of always starting on the server default (Sonnet).
// Per-campaign model is still authoritative on the server (design doc §8); this
// is only the *default selection* for the New Chronicle screen. Same
// client-only localStorage pattern as lib/mute.ts / lib/connection.ts.
const MODEL_KEY = "chronicle.model";

/** The remembered model, or undefined if none has been chosen yet (callers then
 * fall back to the models list default). */
export function loadPreferredModel(): string | undefined {
  try {
    return localStorage.getItem(MODEL_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function savePreferredModel(model: string): void {
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {
    // Non-fatal — worst case the New Chronicle screen falls back to the default.
  }
}
