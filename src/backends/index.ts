import type { DmBackend, ProviderId } from "../dm-backend.js";
import { claudeBackend } from "./claude-backend.js";
import { grokBackend } from "./grok-backend.js";

/** Registry of DM backends keyed by provider (ADR-0018). The Grok backend is a
 * stub until Slice 4 (it throws if selected). */
const BACKENDS: Record<ProviderId, DmBackend> = {
  claude: claudeBackend,
  grok: grokBackend,
};

/** Resolve the backend for a provider. Falls back to Claude for an unknown
 * provider so a bad stored value can never leave a campaign unplayable. */
export function getBackend(provider: ProviderId): DmBackend {
  return BACKENDS[provider] ?? claudeBackend;
}
