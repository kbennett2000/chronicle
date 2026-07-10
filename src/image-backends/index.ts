// ADR-0027: image-backend dispatch + provider resolution. `generateImage`
// resolves a provider and delegates to the chosen ImageBackend here, so every
// image path (in-turn MCP, stdio MCP, both /illustrate branches) stays
// provider-agnostic below a single seam.
import { readUserSettings } from "../user-store.js";
import { campaignDirUserId } from "../campaign-store.js";
import type { CampaignSettings } from "../campaign-store.js";
import { config } from "../config.js";
import {
  isValidImageProvider,
  isValidImageQuality,
  type ImageBackend,
  type ImageProvider,
  type ImageQuality,
} from "./types.js";
import { grokImageBackend } from "./grok.js";
import { localImageBackend } from "./local.js";

/** The backend for a resolved provider. Dispatched at CALL time (a switch, not an
 * eval-time map) so a circular import — image-generator → index → a backend →
 * image-generator — can't hit a TDZ on the backend consts whichever module is the
 * entry point. Falls back to grok for any unknown value (mirrors getBackend()'s
 * claude fallback in src/backends/) so a stale/typo'd provider can never leave a
 * campaign unable to illustrate. */
export function getImageBackend(provider: ImageProvider): ImageBackend {
  switch (provider) {
    case "local":
      return localImageBackend;
    case "grok":
    default:
      return grokImageBackend;
  }
}

/** PURE field-by-field precedence (mirrors resolveMusicConfig / resolveVideoConfig):
 * campaign override → user default → config default (config.defaults.imageProvider,
 * ADR-0033) → code default "grok". A value only wins when it's a valid provider, so
 * a bad stored/config value is ignored rather than breaking generation. The config
 * default is injectable so tests can seed it without the ambient singleton. */
export function resolveImageProvider(
  userProvider?: string,
  campaignProvider?: string,
  configDefault: string = config.defaults.imageProvider
): ImageProvider {
  const pick = campaignProvider ?? userProvider;
  if (isValidImageProvider(pick)) return pick;
  if (isValidImageProvider(configDefault)) return configDefault;
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

/** ADR-0029: PURE precedence for the local quality tier, mirroring
 * resolveImageProvider: campaign override → user default → config default
 * (config.defaults.imageQuality, ADR-0033) → code default "standard". A value only
 * wins when it's a valid tier, so a bad stored/config value is ignored. Code default
 * "standard" keeps every existing game/account byte-identical to pre-0029. */
export function resolveImageQuality(
  userQuality?: string,
  campaignQuality?: string,
  configDefault: string = config.defaults.imageQuality
): ImageQuality {
  const pick = campaignQuality ?? userQuality;
  if (isValidImageQuality(pick)) return pick;
  if (isValidImageQuality(configDefault)) return configDefault;
  return "standard";
}

/** Resolve the effective quality tier for a campaign at the image-generation seam.
 * Like resolveImageProviderForCampaign, this recovers the owning user from the
 * campaigns/<userId>/<id> nesting (ADR-0019) because the seam fires mid-turn inside
 * the MCP tool (and in the stdio subprocess) where only `campaignDir` is in scope. */
export function resolveImageQualityForCampaign(campaignDir: string, settings: CampaignSettings): ImageQuality {
  const userId = campaignDirUserId(campaignDir);
  const userQuality =
    userId !== undefined ? (readUserSettings(userId).imageQuality as string | undefined) : undefined;
  return resolveImageQuality(userQuality, settings.imageQuality);
}
