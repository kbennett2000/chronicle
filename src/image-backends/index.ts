// ADR-0027: image-backend dispatch + provider resolution. `generateImage`
// resolves a provider and delegates to the chosen ImageBackend here, so every
// image path (in-turn MCP, stdio MCP, both /illustrate branches) stays
// provider-agnostic below a single seam.
import { readUserSettings } from "../user-store.js";
import { campaignDirUserId } from "../campaign-store.js";
import type { CampaignSettings } from "../campaign-store.js";
import { isValidImageProvider, type ImageBackend, type ImageProvider } from "./types.js";
import { grokImageBackend } from "./grok.js";
// COMMIT 2 (ADR-0027) registers the local ComfyUI backend here.

const BACKENDS: Partial<Record<ImageProvider, ImageBackend>> = {
  grok: grokImageBackend,
};

/** The backend for a resolved provider. Falls back to grok for any provider not
 * in the registry (mirrors getBackend()'s claude fallback in src/backends/), so a
 * stored/unknown value can never leave a campaign unable to illustrate. */
export function getImageBackend(provider: ImageProvider): ImageBackend {
  return BACKENDS[provider] ?? grokImageBackend;
}

/** PURE field-by-field precedence (mirrors resolveMusicConfig / resolveVideoConfig):
 * campaign override → user default → `.env` (DEFAULT_IMAGE_PROVIDER) → code default
 * "grok". A value only wins when it's a valid provider, so a bad stored/env value
 * is ignored rather than breaking generation. */
export function resolveImageProvider(userProvider?: string, campaignProvider?: string): ImageProvider {
  const pick = campaignProvider ?? userProvider;
  if (isValidImageProvider(pick)) return pick;
  const env = process.env.DEFAULT_IMAGE_PROVIDER;
  if (isValidImageProvider(env)) return env;
  return "grok";
}

/** Resolve the effective provider for a campaign at the image-generation seam.
 * The seam sits below the route (it fires mid-turn inside the MCP tool, and in a
 * separate stdio subprocess) where only `campaignDir` is in scope — so, unlike the
 * music/video routes, we recover the owning user from the campaigns/<userId>/<id>
 * nesting (ADR-0019) and read their default here, rather than threading `userId`
 * through the provider-neutral DM seam. */
export function resolveImageProviderForCampaign(campaignDir: string, settings: CampaignSettings): ImageProvider {
  const userId = campaignDirUserId(campaignDir);
  const userProvider =
    userId !== undefined ? (readUserSettings(userId).imageProvider as string | undefined) : undefined;
  return resolveImageProvider(userProvider, settings.imageProvider);
}
