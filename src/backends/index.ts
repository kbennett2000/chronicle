import type { DmBackend, ProviderId } from "../dm-backend.js";
import { claudeBackend } from "./claude-backend.js";

/** Registry of DM backends keyed by provider (ADR-0018). Slice 1 ships only
 * Claude; the Grok backend is added in a later slice. */
const BACKENDS: Record<ProviderId, DmBackend> = {
  claude: claudeBackend,
  // grok: added in Slice 4 (stub in Slice 2)
} as Record<ProviderId, DmBackend>;

/** Resolve the backend for a provider. Falls back to Claude for an unknown
 * provider so a bad stored value can never leave a campaign unplayable. */
export function getBackend(provider: ProviderId): DmBackend {
  return BACKENDS[provider] ?? claudeBackend;
}
