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

export async function getMusicConfig(connection: Connection): Promise<MusicConfig> {
  return (await apiFetch(connection, "/music/config")) as MusicConfig;
}

export async function saveMusicSettings(
  connection: Connection,
  music: Partial<{ enabled: boolean; source: MusicSource; navidromeUrl: string; navidromePlaylist: string }>
): Promise<void> {
  await apiFetch(connection, "/me/settings", { method: "POST", body: JSON.stringify({ music }) });
}

async function getLocalTracks(connection: Connection): Promise<Track[]> {
  const { tracks } = (await apiFetch(connection, "/music/local/tracks")) as {
    tracks: { path: string; name: string }[];
  };
  return tracks.map((t) => ({ id: t.path, name: t.name }));
}

async function getNavidromeTracks(connection: Connection): Promise<Track[]> {
  const { tracks } = (await apiFetch(connection, "/music/navidrome/playlist")) as {
    tracks: { id: string; title: string; artist: string }[];
  };
  return tracks.map((t) => ({ id: t.id, name: t.artist ? `${t.artist} — ${t.title}` : t.title }));
}

/** Stream URL for the current source, with the session token as a query param so
 * the bare <audio> request authenticates (ADR-0020). */
function trackUrl(connection: Connection, source: MusicSource, id: string): string {
  const base = serverOrigin(connection);
  const token = encodeURIComponent(connection.token);
  return source === "local"
    ? `${base}/music/local/track?path=${encodeURIComponent(id)}&token=${token}`
    : `${base}/music/navidrome/stream?id=${encodeURIComponent(id)}&token=${token}`;
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
}

/** Owns an Audio element and a shuffled playlist. Loads the user's music config,
 * fetches tracks for the chosen source, and plays through them (advancing on
 * `ended`). Respects `muted` (pause/resume) and browser autoplay blocking (arms
 * a one-shot gesture listener). Nothing plays unless music is enabled AND
 * unmuted. */
export function useMusicPlayer(connection: Connection, muted: boolean): MusicPlayerState {
  const [enabled, setEnabled] = useState(false);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playlistRef = useRef<Track[]>([]);
  const indexRef = useRef(0);
  const sourceRef = useRef<MusicSource>("local");
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

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
      audio.src = trackUrl(connection, sourceRef.current, track.id);
      setCurrentName(track.name);
      if (!mutedRef.current) audio.play().catch(() => armGesture());
    };
    const next = () => {
      indexRef.current = (indexRef.current + 1) % Math.max(1, playlistRef.current.length);
      playCurrent();
    };
    let armed = false;
    const onGesture = () => {
      if (!mutedRef.current) audio.play().catch(() => {});
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
        const config = await getMusicConfig(connection);
        if (cancelled) return;
        setEnabled(config.enabled);
        if (!config.enabled) return;
        sourceRef.current = config.source;
        const tracks =
          config.source === "navidrome" ? await getNavidromeTracks(connection) : await getLocalTracks(connection);
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
  }, [connection.serverAddress, connection.token]);

  // React to mute changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (muted) audio.pause();
    else if (audio.src) audio.play().catch(() => {});
  }, [muted]);

  return { enabled, currentName, error };
}
