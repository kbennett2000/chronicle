// ADR-0034: video-backend dispatch + provider resolution. `generateVideo` resolves
// a provider and delegates to the chosen VideoBackend here, so the /animate route
// stays provider-agnostic below a single seam. Mirrors src/image-backends/index.ts.
import { readUserSettings } from "../user-store.js";
import { campaignDirUserId } from "../campaign-store.js";
import type { CampaignSettings } from "../campaign-store.js";
import { config } from "../config.js";
import { isValidVideoProvider, type VideoBackend, type VideoProvider } from "./types.js";
import { grokVideoBackend } from "./grok.js";
import { localVideoBackend } from "./local.js";
import { DEFAULT_ANIMATE_MODEL, isAnimateModel, type AnimateModel } from "./video-models.js";

/** The backend for a resolved provider. Dispatched at CALL time (a switch, not an
 * eval-time map) so an import cycle can't hit a TDZ on the backend consts. Falls
 * back to grok for any unknown value (mirrors getImageBackend) so a stale/typo'd
 * provider can never leave a campaign unable to animate. */
export function getVideoBackend(provider: VideoProvider): VideoBackend {
  switch (provider) {
    case "local":
      return localVideoBackend;
    case "grok":
    default:
      return grokVideoBackend;
  }
}

/** PURE field-by-field precedence (mirrors resolveImageProvider): campaign override
 * → user default → config default (config.defaults.videoProvider, ADR-0033) → code
 * default "grok". A value only wins when it's a valid provider, so a bad
 * stored/config value is ignored. The config default is injectable for tests. */
export function resolveVideoProvider(
  userProvider?: string,
  campaignProvider?: string,
  configDefault: string = config.defaults.videoProvider
): VideoProvider {
  const pick = campaignProvider ?? userProvider;
  if (isValidVideoProvider(pick)) return pick;
  if (isValidVideoProvider(configDefault)) return configDefault;
  return "grok";
}

/** Resolve the effective video provider for a campaign. Recovers the owning user
 * from the campaigns/<userId>/<id> nesting (ADR-0019) and reads their default, so
 * `generateVideo` stays self-contained (like resolveImageProviderForCampaign). */
export function resolveVideoProviderForCampaign(campaignDir: string, settings: CampaignSettings): VideoProvider {
  const userId = campaignDirUserId(campaignDir);
  const userProvider =
    userId !== undefined ? (readUserSettings(userId).videoProvider as string | undefined) : undefined;
  return resolveVideoProvider(userProvider, settings.videoProvider);
}

/** ADR-0035: PURE precedence for the local video model, mirroring resolveVideoProvider:
 * campaign override → user default → config default (config.defaults.videoModel) → code
 * default (DEFAULT_ANIMATE_MODEL = "ltxv"). A value only wins when it's a known model id. */
export function resolveVideoModel(
  userModel?: string,
  campaignModel?: string,
  configDefault: string = config.defaults.videoModel
): AnimateModel {
  const pick = campaignModel ?? userModel;
  if (isAnimateModel(pick)) return pick;
  if (isAnimateModel(configDefault)) return configDefault;
  return DEFAULT_ANIMATE_MODEL;
}

/** Resolve the effective local video model for a campaign — recovers the owning user
 * from the campaigns/<userId>/<id> nesting (ADR-0019), like the provider resolver. */
export function resolveVideoModelForCampaign(campaignDir: string, settings: CampaignSettings): AnimateModel {
  const userId = campaignDirUserId(campaignDir);
  const userModel = userId !== undefined ? (readUserSettings(userId).videoModel as string | undefined) : undefined;
  return resolveVideoModel(userModel, settings.videoModel);
}
