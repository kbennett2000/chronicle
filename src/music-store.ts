import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ADR-0020: music playback. Two sources — local files under `music/`, or a
// Navidrome playlist proxied through this server via its Subsonic API. Config
// comes from `.env` with optional per-user overrides (never the Navidrome
// credentials, which stay server-side).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MUSIC_ROOT = path.resolve(__dirname, "../music");

export const MUSIC_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};

const PLAYABLE_EXTS = new Set(Object.keys(MUSIC_CONTENT_TYPES));

export interface LocalTrack {
  /** Path relative to MUSIC_ROOT, forward-slashed — the id the client passes
   * back to stream it. */
  path: string;
  /** Display name (the file's basename without extension). */
  name: string;
}

/** Every playable file under `music/`, recursively (any sub-folder layout the
 * user likes). Returns [] if the folder doesn't exist yet. */
export function listLocalTracks(): LocalTrack[] {
  if (!fs.existsSync(MUSIC_ROOT)) return [];
  const out: LocalTrack[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (PLAYABLE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        const rel = path.relative(MUSIC_ROOT, abs).split(path.sep).join("/");
        out.push({ path: rel, name: entry.name.replace(/\.[^.]+$/, "") });
      }
    }
  };
  walk(MUSIC_ROOT);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Resolve a client-supplied relative path to an absolute file under MUSIC_ROOT,
 * or null if it escapes the folder / isn't a playable file. Same traversal-guard
 * shape as the campaign image route. */
export function resolveLocalTrack(relPath: string): string | null {
  const resolved = path.resolve(MUSIC_ROOT, relPath);
  if (resolved !== MUSIC_ROOT && !resolved.startsWith(MUSIC_ROOT + path.sep)) return null;
  if (!PLAYABLE_EXTS.has(path.extname(resolved).toLowerCase())) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  return resolved;
}

// ── Music config (env + per-user override) ───────────────────────────────────

export type MusicSource = "local" | "navidrome";

/** A user's stored music override (a `music` key in their account settings). */
export interface UserMusic {
  enabled?: boolean;
  source?: MusicSource;
  navidromeUrl?: string;
  navidromePlaylist?: string;
}

/** The effective, client-safe music config — no credentials. */
export interface MusicConfig {
  enabled: boolean;
  source: MusicSource;
  navidrome: {
    url: string;
    playlist: string;
    /** True when NAVIDROME_USER + NAVIDROME_PASSWORD are set on the server, so
     * the Navidrome source can actually stream. */
    configured: boolean;
  };
}

function envBool(v: string | undefined, fallback: boolean): boolean {
  return v === "true" ? true : v === "false" ? false : fallback;
}

/** Validate/normalize a raw stored or posted music override into a UserMusic,
 * dropping the Navidrome credentials (they stay server-side) and rejecting type
 * violations. Shared by the user-defaults validator, the per-campaign settings
 * route (#109), and readCampaignSettings so all three agree on the shape. */
export function parseMusicBlock(raw: unknown): { value: UserMusic } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "music must be an object" };
  const m = raw as Record<string, unknown>;
  const music: UserMusic = {};
  if (m.enabled !== undefined) {
    if (typeof m.enabled !== "boolean") return { error: "music.enabled must be a boolean" };
    music.enabled = m.enabled;
  }
  if (m.source !== undefined) {
    if (m.source !== "local" && m.source !== "navidrome") {
      return { error: "music.source must be 'local' or 'navidrome'" };
    }
    music.source = m.source;
  }
  if (m.navidromeUrl !== undefined) {
    if (typeof m.navidromeUrl !== "string") return { error: "music.navidromeUrl must be a string" };
    music.navidromeUrl = m.navidromeUrl;
  }
  if (m.navidromePlaylist !== undefined) {
    if (typeof m.navidromePlaylist !== "string") return { error: "music.navidromePlaylist must be a string" };
    music.navidromePlaylist = m.navidromePlaylist;
  }
  return { value: music };
}

/** Effective, client-safe music config. Precedence is field-by-field:
 * campaign override → user override → `.env` default (#109 / ADR-0020 amended).
 * A per-game override wins where set; each unset field falls through to the
 * user's account default, then to `.env`. */
export function resolveMusicConfig(userMusic: UserMusic = {}, campaignMusic: UserMusic = {}): MusicConfig {
  const pick = <K extends keyof UserMusic>(key: K): UserMusic[K] =>
    campaignMusic[key] ?? userMusic[key];
  const chosenSource = pick("source");
  const source: MusicSource =
    chosenSource === "navidrome" || chosenSource === "local"
      ? chosenSource
      : process.env.DEFAULT_MUSIC_SOURCE === "navidrome"
        ? "navidrome"
        : "local";
  return {
    enabled: pick("enabled") ?? envBool(process.env.DEFAULT_MUSIC_ENABLED, false),
    source,
    navidrome: {
      url: (pick("navidromeUrl") || process.env.NAVIDROME_URL || "").replace(/\/$/, ""),
      playlist: pick("navidromePlaylist") || process.env.NAVIDROME_PLAYLIST || "",
      configured: Boolean(process.env.NAVIDROME_USER && process.env.NAVIDROME_PASSWORD),
    },
  };
}

// ── Navidrome (Subsonic API) ─────────────────────────────────────────────────

export interface NavidromeCreds {
  url: string;
  user: string;
  password: string;
  playlist: string;
}

/** Resolve the server-side Navidrome creds for a user's effective config, or
 * null if incomplete (missing URL/user/password). The URL/playlist come from the
 * resolved (possibly user-overridden) config; user/password are env-only. */
export function navidromeCreds(cfg: MusicConfig): NavidromeCreds | null {
  const user = process.env.NAVIDROME_USER;
  const password = process.env.NAVIDROME_PASSWORD;
  if (!cfg.navidrome.url || !user || !password) return null;
  return { url: cfg.navidrome.url, user, password, playlist: cfg.navidrome.playlist };
}

/** Subsonic token auth params: t=md5(password+salt), s=salt (never the password
 * in the clear). Shared by every /rest call and the stream URL. */
function subsonicAuthParams(creds: NavidromeCreds): URLSearchParams {
  const salt = crypto.randomBytes(8).toString("hex");
  const token = crypto.createHash("md5").update(creds.password + salt).digest("hex");
  return new URLSearchParams({
    u: creds.user,
    t: token,
    s: salt,
    v: "1.16.1",
    c: "chronicle",
    f: "json",
  });
}

export interface NavidromeTrack {
  id: string;
  title: string;
  artist: string;
}

async function subsonicGet(creds: NavidromeCreds, endpoint: string, extra: Record<string, string> = {}): Promise<any> {
  const params = subsonicAuthParams(creds);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const res = await fetch(`${creds.url}/rest/${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error(`Navidrome ${endpoint} failed (${res.status})`);
  const data = (await res.json()) as any;
  const sub = data["subsonic-response"];
  if (!sub || sub.status !== "ok") {
    throw new Error(`Navidrome ${endpoint} error: ${sub?.error?.message ?? "unknown"}`);
  }
  return sub;
}

/** Resolve the configured playlist (by name, case-insensitive) to its track
 * list. Throws with an actionable message if the playlist isn't found. */
export async function navidromePlaylistTracks(creds: NavidromeCreds): Promise<NavidromeTrack[]> {
  const lists = await subsonicGet(creds, "getPlaylists");
  const playlists: any[] = lists.playlists?.playlist ?? [];
  const target = creds.playlist.trim().toLowerCase();
  const match = playlists.find((p) => String(p.name).toLowerCase() === target) ?? (target ? undefined : playlists[0]);
  if (!match) {
    throw new Error(`Navidrome playlist "${creds.playlist}" not found`);
  }
  const detail = await subsonicGet(creds, "getPlaylist", { id: String(match.id) });
  const entries: any[] = detail.playlist?.entry ?? [];
  return entries.map((e) => ({
    id: String(e.id),
    title: String(e.title ?? "Untitled"),
    artist: String(e.artist ?? ""),
  }));
}

/** The full Navidrome stream URL (with fresh auth params) for one song — the
 * server fetches this and pipes it to the client (creds never reach the browser). */
export function navidromeStreamUrl(creds: NavidromeCreds, songId: string): string {
  const params = subsonicAuthParams(creds);
  params.set("id", songId);
  return `${creds.url}/rest/stream?${params.toString()}`;
}
