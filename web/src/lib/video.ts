import { apiFetch } from "./api";
import type { Connection } from "./connection";

// Issue #118: on-demand video clips (ADR-0026). Params are prompt-driven and
// resolved server-side campaign → user → .env → default (mirrors music). This
// module owns the client-side types + the two-level config read/write; the
// per-action "Animate" calls live in campaign.ts alongside illustrate.

export type VideoResolution = "480p" | "720p";
export const VIDEO_RESOLUTIONS: VideoResolution[] = ["480p", "720p"];

export type VideoAspect = "square" | "16:9" | "9:16";
export const VIDEO_ASPECTS: VideoAspect[] = ["square", "16:9", "9:16"];

export const MIN_VIDEO_SECONDS = 1;
export const MAX_VIDEO_SECONDS = 15;

/** A stored per-account or per-game video-params override (all optional). */
export type VideoOverride = Partial<{
  durationSeconds: number;
  resolution: VideoResolution;
  aspectRatio: VideoAspect;
}>;

/** The effective, fully-resolved params the server returns. */
export interface VideoConfig {
  durationSeconds: number;
  resolution: VideoResolution;
  aspectRatio: VideoAspect;
}

function campaignQuery(campaignId?: string | null): string {
  return campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
}

/** The effective params, resolving a per-game override when a campaign is in
 * scope (campaign → user → .env → default), else the account-level default. */
export async function getVideoConfig(connection: Connection, campaignId?: string | null): Promise<VideoConfig> {
  return (await apiFetch(connection, `/video/config${campaignQuery(campaignId)}`)) as VideoConfig;
}

/** Persist the account-level default params (player defaults). */
export async function saveVideoSettings(connection: Connection, video: VideoOverride): Promise<void> {
  await apiFetch(connection, "/me/settings", { method: "POST", body: JSON.stringify({ video }) });
}

/** Persist a per-game params override on the campaign's settings. */
export async function saveCampaignVideoSettings(
  connection: Connection,
  campaignId: string,
  video: VideoOverride
): Promise<void> {
  await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/settings`, {
    method: "POST",
    body: JSON.stringify({ video }),
  });
}

/** Drop a game's params override so it resumes tracking the account default.
 * `null` is the reset signal (mirrors resetCampaignMusicSettings). */
export async function resetCampaignVideoSettings(connection: Connection, campaignId: string): Promise<void> {
  await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/settings`, {
    method: "POST",
    body: JSON.stringify({ video: null }),
  });
}
