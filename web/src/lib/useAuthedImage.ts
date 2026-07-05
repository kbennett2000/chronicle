import { useEffect, useState } from "react";
import { fetchImageBlob } from "./api";
import type { Connection } from "./connection";

export type AuthedImageStatus = "empty" | "loading" | "loaded" | "error";

export interface AuthedImage {
  url: string | null;
  /** "loaded" is the only status with a live `url`. Views' gallery (the
   * first consumer needing more than "is there a picture right now") uses
   * this to count only images that actually resolved toward its "N of M
   * illustrated" header — a recorded-but-missing file (Slice 23's
   * sabotage case) must not count as illustrated just because a filename
   * was recorded. */
  status: AuthedImageStatus;
}

/** Turns a campaign image filename into a same-origin blob: URL, since
 * the image route requires the same auth header as everything else and
 * a plain <img src> can't attach one. `url` is null while loading, once
 * fetched successfully it's a blob: URL; on any failure (missing file,
 * network, auth) it settles back to null so the caller renders its
 * normal no-image state rather than a broken-image icon. */
export function useAuthedImage(connection: Connection, campaignId: string, filename: string | undefined): AuthedImage {
  const [state, setState] = useState<AuthedImage>({ url: null, status: filename ? "loading" : "empty" });

  useEffect(() => {
    if (!filename) {
      setState({ url: null, status: "empty" });
      return;
    }
    setState({ url: null, status: "loading" });
    // Per src/image-generator.ts, the value recorded in a state-file
    // entry (character-sheet.json's portraitImage, npc-roster.md's
    // "Portrait asset ID") is generateImage's own relPath, e.g.
    // "images/npc-garrick.jpg" — but GET /images/:filename's route
    // pattern excludes "/" entirely, so any directory prefix must be
    // stripped down to the bare basename before building this URL.
    const basename = filename.split("/").pop() || filename;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchImageBlob(connection, `/campaigns/${encodeURIComponent(campaignId)}/images/${encodeURIComponent(basename)}`)
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
  }, [connection, campaignId, filename]);

  return state;
}
