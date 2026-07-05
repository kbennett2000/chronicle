// Issue #60: the player's last-chosen "look & play" settings, remembered
// client-side so a NEW game defaults to them instead of reverting to the
// server defaults (images off, standard art/dice/intensity). Per-campaign
// settings stay authoritative on the server; this is only the *default
// selection* seeded into the New Chronicle screen. Same client-only
// localStorage pattern as lib/modelPref.ts / lib/mute.ts / lib/connection.ts.
//
// Kris's complaint that "starting a new game reverts many previously made
// settings" was exactly this gap — model already had it (#57, modelPref.ts),
// the look/play dials did not.

/** The look/play settings we remember as new-game defaults. Mirrors the same
 * fields on CampaignSettings / CampaignCreationSettings. `model` is handled
 * separately by modelPref.ts and is deliberately not duplicated here. */
export interface LookPrefs {
  generateImages: boolean;
  autoIllustrateTurns: boolean;
  artStyle: string;
  autoRollDice: boolean;
  contentIntensity: "standard" | "low";
}

const KEY = "chronicle.lookPrefs";

/** The remembered look/play prefs, or `{}` if none have been chosen yet
 * (callers then keep the server-side defaults). Only well-typed values are
 * returned — a corrupt/partial blob degrades to absent fields, never throws. */
export function loadLookPrefs(): Partial<LookPrefs> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const prefs: Partial<LookPrefs> = {};
    if (typeof parsed.generateImages === "boolean") prefs.generateImages = parsed.generateImages;
    if (typeof parsed.autoIllustrateTurns === "boolean") prefs.autoIllustrateTurns = parsed.autoIllustrateTurns;
    if (typeof parsed.artStyle === "string") prefs.artStyle = parsed.artStyle;
    if (typeof parsed.autoRollDice === "boolean") prefs.autoRollDice = parsed.autoRollDice;
    if (parsed.contentIntensity === "standard" || parsed.contentIntensity === "low") {
      prefs.contentIntensity = parsed.contentIntensity;
    }
    return prefs;
  } catch {
    return {};
  }
}

/** Remember one look/play pref, merging onto whatever is already stored.
 * Non-fatal on failure — worst case the New Chronicle screen falls back to the
 * server defaults. */
export function saveLookPref<K extends keyof LookPrefs>(key: K, value: LookPrefs[K]): void {
  try {
    const current = loadLookPrefs();
    localStorage.setItem(KEY, JSON.stringify({ ...current, [key]: value }));
  } catch {
    // ignore — remembering the default is best-effort.
  }
}
