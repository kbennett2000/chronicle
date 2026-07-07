import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";
import { serverOrigin, type Connection } from "./connection";

// ADR-0020: music playback. The config + track lists come from the server; the
// <audio> element streams tracks by URL (auth via ?token=, since a media element
// can't attach the X-Chronicle-Token header).

export type MusicSource = "local" | "navidrome";

export interface MusicConfig {
  enabled: boolean;
  source: MusicSource;
  navidrome: { url: string; playlist: string; configured: boolean };
  localTrackCount: number;
}

export interface Track {
  /** For local: the relative path. For navidrome: the song id. */
  id: string;
  name: string;
}

export type MusicOverride = Partial<{
  enabled: boolean;
  source: MusicSource;
  navidromeUrl: string;
  navidromePlaylist: string;
}>;

/** #109: append `?campaignId=` when a game is in scope, so the server resolves the
 * effective config field-by-field (campaign override → user default → .env). */
function campaignQuery(campaignId?: string | null): string {
  return campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
}

export async function getMusicConfig(connection: Connection, campaignId?: string | null): Promise<MusicConfig> {
  return (await apiFetch(connection, `/music/config${campaignQuery(campaignId)}`)) as MusicConfig;
}

export async function saveMusicSettings(connection: Connection, music: MusicOverride): Promise<void> {
  await apiFetch(connection, "/me/settings", { method: "POST", body: JSON.stringify({ music }) });
}

/** #109: persist a per-game music override on the campaign's settings. Same shape
 * as the account default; empty-string subfields clear that field back to the
 * user/.env fallback. */
export async function saveCampaignMusicSettings(
  connection: Connection,
  campaignId: string,
  music: MusicOverride
): Promise<void> {
  await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/settings`, {
    method: "POST",
    body: JSON.stringify({ music }),
  });
}

/** #109: drop a game's music override entirely, so it resumes tracking the
 * user's account default. `null` is the reset signal (the only way to clear a
 * stored boolean `enabled`, which the empty-string path can't touch). */
export async function resetCampaignMusicSettings(connection: Connection, campaignId: string): Promise<void> {
  await apiFetch(connection, `/campaigns/${encodeURIComponent(campaignId)}/settings`, {
    method: "POST",
    body: JSON.stringify({ music: null }),
  });
}

async function getLocalTracks(connection: Connection): Promise<Track[]> {
  const { tracks } = (await apiFetch(connection, "/music/local/tracks")) as {
    tracks: { path: string; name: string }[];
  };
  return tracks.map((t) => ({ id: t.path, name: t.name }));
}

async function getNavidromeTracks(connection: Connection, campaignId?: string | null): Promise<Track[]> {
  const { tracks } = (await apiFetch(connection, `/music/navidrome/playlist${campaignQuery(campaignId)}`)) as {
    tracks: { id: string; title: string; artist: string }[];
  };
  return tracks.map((t) => ({ id: t.id, name: t.artist ? `${t.artist} — ${t.title}` : t.title }));
}

/** Stream URL for the current source, with the session token as a query param so
 * the bare <audio> request authenticates (ADR-0020). For Navidrome the active
 * campaign is passed too, so the per-game override resolves the same URL the
 * playlist was fetched from (#109). */
function trackUrl(connection: Connection, source: MusicSource, id: string, campaignId?: string | null): string {
  const base = serverOrigin(connection);
  const token = encodeURIComponent(connection.token);
  if (source === "local") {
    return `${base}/music/local/track?path=${encodeURIComponent(id)}&token=${token}`;
  }
  const camp = campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : "";
  return `${base}/music/navidrome/stream?id=${encodeURIComponent(id)}&token=${token}${camp}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface MusicPlayerState {
  /** Whether music is enabled for this user (drives whether the mute button shows). */
  enabled: boolean;
  /** The track currently loaded, for an optional now-playing label. */
  currentName: string | null;
  /** A human-readable problem (no tracks, Navidrome unreachable), else null. */
  error: string | null;
  /** Whether playback is manually paused — distinct from muted (issue #108). */
  isPaused: boolean;
  /** Pause playback (manual, independent of mute). */
  pause: () => void;
  /** Resume playback after a manual pause. */
  resume: () => void;
  /** Skip to the next track (clears a manual pause). */
  next: () => void;
  /** Skip to the previous track (clears a manual pause). */
  prev: () => void;
  /** Re-fetch config + playlist (e.g. after a per-game override changes mid-game, #109). */
  reload: () => void;
}

/** Owns an Audio element and a shuffled playlist. Loads the user's music config,
 * fetches tracks for the chosen source, and plays through them (advancing on
 * `ended`). Respects `muted` and a manual `paused` flag (issue #108: a separate
 * pause so the transport controls don't fight the mute button), plus browser
 * autoplay blocking (arms a one-shot gesture listener). Nothing plays unless
 * music is enabled AND unmuted AND not manually paused. */
export function useMusicPlayer(connection: Connection, muted: boolean, campaignId?: string | null): MusicPlayerState {
  const [enabled, setEnabled] = useState(false);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  // #109: bump to force a config/playlist re-fetch (a per-game override changed).
  const [reloadNonce, setReloadNonce] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playlistRef = useRef<Track[]>([]);
  const indexRef = useRef(0);
  const sourceRef = useRef<MusicSource>("local");
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // The live next/prev closures live inside the load effect (they close over
  // playCurrent); the returned callbacks are stable and delegate through this ref.
  const controlsRef = useRef<{ next: () => void; prev: () => void }>({ next: () => {}, prev: () => {} });

  // Load config + playlist once per connection.
  useEffect(() => {
    let cancelled = false;
    const audio = new Audio();
    audio.volume = 0.32;
    audioRef.current = audio;

    const playCurrent = () => {
      const list = playlistRef.current;
      if (!list.length) return;
      const track = list[indexRef.current % list.length];
      audio.src = trackUrl(connection, sourceRef.current, track.id, campaignId);
      setCurrentName(track.name);
      if (!mutedRef.current && !pausedRef.current) audio.play().catch(() => armGesture());
    };
    // A manual skip always resumes playback (clearing any manual pause).
    const clearPaused = () => {
      pausedRef.current = false;
      setPaused(false);
    };
    const next = () => {
      indexRef.current = (indexRef.current + 1) % Math.max(1, playlistRef.current.length);
      clearPaused();
      playCurrent();
    };
    const prev = () => {
      const len = Math.max(1, playlistRef.current.length);
      indexRef.current = (indexRef.current - 1 + len) % len;
      clearPaused();
      playCurrent();
    };
    controlsRef.current = { next, prev };
    let armed = false;
    const onGesture = () => {
      if (!mutedRef.current && !pausedRef.current) audio.play().catch(() => {});
      disarm();
    };
    const disarm = () => {
      if (!armed) return;
      armed = false;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    const armGesture = () => {
      if (armed) return;
      armed = true;
      window.addEventListener("pointerdown", onGesture);
      window.addEventListener("keydown", onGesture);
    };
    audio.addEventListener("ended", next);

    (async () => {
      try {
        setError(null);
        const config = await getMusicConfig(connection, campaignId);
        if (cancelled) return;
        setEnabled(config.enabled);
        if (!config.enabled) return;
        sourceRef.current = config.source;
        const tracks =
          config.source === "navidrome"
            ? await getNavidromeTracks(connection, campaignId)
            : await getLocalTracks(connection);
        if (cancelled) return;
        if (!tracks.length) {
          setError(
            config.source === "navidrome"
              ? "The Navidrome playlist is empty or unreachable."
              : "No music files found in the music/ folder."
          );
          return;
        }
        playlistRef.current = shuffle(tracks);
        indexRef.current = 0;
        playCurrent();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load music.");
      }
    })();

    return () => {
      cancelled = true;
      disarm();
      audio.removeEventListener("ended", next);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.serverAddress, connection.token, campaignId, reloadNonce]);

  // React to mute OR manual-pause changes. Playback resumes only when BOTH are
  // clear, so muting and manually pausing stay independent (issue #108: unmuting
  // must not override a manual pause, and resuming must not override a mute).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const shouldPlay = !muted && !paused;
    if (!shouldPlay) audio.pause();
    else if (audio.src) audio.play().catch(() => {});
  }, [muted, paused]);

  // Stable callbacks (identity preserved across renders) so Play.tsx buttons and
  // effects don't churn. next/prev delegate to the live closures in controlsRef.
  const next = useRef(() => controlsRef.current.next()).current;
  const prev = useRef(() => controlsRef.current.prev()).current;
  const pause = useRef(() => {
    pausedRef.current = true;
    setPaused(true);
  }).current;
  const resume = useRef(() => {
    pausedRef.current = false;
    setPaused(false);
  }).current;
  const reload = useRef(() => setReloadNonce((n) => n + 1)).current;

  return { enabled, currentName, error, isPaused: paused, pause, resume, next, prev, reload };
}
