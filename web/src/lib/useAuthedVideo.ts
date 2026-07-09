import { useEffect, useState } from "react";
import { fetchImageBlob } from "./api";
import type { Connection } from "./connection";

export type AuthedVideoStatus = "empty" | "loading" | "loaded" | "error";

export interface AuthedVideo {
  url: string | null;
  status: AuthedVideoStatus;
}

/** Issue #118: the video analog of useAuthedImage. The video route is auth-gated
 * exactly like images, so a bare <video src> can't attach the token header —
 * fetch the clip as a blob (fetchImageBlob is content-type-agnostic) and hand a
 * blob: URL to <video>. `url` is null while loading and on any failure, so the
 * caller renders its normal no-video state. The `cacheBust` `?v=` mirrors the
 * image hook: a re-animated clip reuses the same deterministic filename. */
export function useAuthedVideo(
  connection: Connection,
  campaignId: string,
  filename: string | undefined,
  cacheBust?: string | number
): AuthedVideo {
  const [state, setState] = useState<AuthedVideo>({ url: null, status: filename ? "loading" : "empty" });

  useEffect(() => {
    if (!filename) {
      setState({ url: null, status: "empty" });
      return;
    }
    setState({ url: null, status: "loading" });
    // The recorded value is generateVideo's relPath, e.g. "videos/npc-x.mp4";
    // GET /videos/:filename excludes "/", so strip to the bare basename.
    const basename = filename.split("/").pop() || filename;
    const bust = cacheBust ? `?v=${encodeURIComponent(String(cacheBust))}` : "";
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchImageBlob(
      connection,
      `/campaigns/${encodeURIComponent(campaignId)}/videos/${encodeURIComponent(basename)}${bust}`
    )
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, status: "loaded" });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, status: "error" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [connection, campaignId, filename, cacheBust]);

  return state;
}
