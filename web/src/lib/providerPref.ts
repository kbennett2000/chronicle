// ADR-0018: the player's last-chosen DM provider (Claude vs Grok), remembered
// client-side so a new game defaults to it instead of always the server default
// (Claude). Per-campaign provider is still authoritative on the server (design
// doc §8, like model); this is only the *default selection* for the New
// Chronicle screen. Same client-only localStorage pattern as lib/modelPref.ts.
const PROVIDER_KEY = "chronicle.provider";

/** The remembered provider, or undefined if none has been chosen yet (callers
 * then fall back to the models list defaultProvider). */
export function loadPreferredProvider(): string | undefined {
  try {
    return localStorage.getItem(PROVIDER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function savePreferredProvider(provider: string): void {
  try {
    localStorage.setItem(PROVIDER_KEY, provider);
  } catch {
    // Non-fatal — worst case the New Chronicle screen falls back to the default.
  }
}
