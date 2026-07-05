import { useEffect, useState } from "react";
import { fetchImageBlob } from "./api";
import type { Connection } from "./connection";

/** Turns a campaign image filename into a same-origin blob: URL, since
 * the image route requires the same auth header as everything else and
 * a plain <img src> can't attach one. Returns null while loading, once
 * fetched successfully it's a blob: URL; on any failure (missing file,
 * network, auth) it settles back to null so the caller renders its
 * normal no-image state rather than a broken-image icon. */
export function useAuthedImage(connection: Connection, campaignId: string, filename: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!filename) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchImageBlob(connection, `/campaigns/${encodeURIComponent(campaignId)}/images/${encodeURIComponent(filename)}`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [connection, campaignId, filename]);

  return url;
}
