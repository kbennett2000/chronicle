import { useEffect, useRef, useState } from "react";
import { fetchImageBlob } from "../lib/api";
import { listPastImages } from "../lib/campaign";
import type { Connection } from "../lib/connection";

/** Issue #105: while a brand-new game's opening scene generates (a long wait),
 * show a soft, slowly cross-fading slideshow of images from the player's PAST
 * games behind the loader. If they have no prior images, this renders nothing
 * and the loader looks exactly as before. */

/** How long each image is held before dissolving to the next. */
const DISPLAY_MS = 7000;
/** Cross-dissolve duration — kept well under DISPLAY_MS so it reads as a slow,
 * gentle fade, never a flash. Mirrored in the inline `transition` below. */
const FADE_MS = 1200;
/** Cap how many images we load into memory for one loading screen — plenty for
 * a slideshow, bounded so a player with a huge back-catalogue doesn't pull tens
 * of MB of blobs for a screen they'll see for a few seconds. */
const MAX_IMAGES = 16;

function shuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function LoadingSlideshow({ connection, campaignId }: { connection: Connection; campaignId: string }) {
  // Loaded blob: URLs, in display order. Populated asynchronously; a failed
  // fetch is simply dropped rather than shown as a broken tile.
  const [urls, setUrls] = useState<string[]>([]);
  // Two stacked layers cross-fade: whichever is `active` is at opacity 1, the
  // other fades out beneath it. `pos` indexes into `urls` for each layer.
  const [layers, setLayers] = useState<[number, number]>([0, 0]);
  const [active, setActive] = useState<0 | 1>(0);
  const nextPosRef = useRef(1);

  // Fetch the list, then load each image as a blob: URL. Revoke everything on
  // unmount so we don't leak object URLs.
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      let refs;
      try {
        refs = await listPastImages(connection, campaignId);
      } catch {
        return; // no slideshow if we can't list — loader shows on its own
      }
      const picked = shuffle(refs).slice(0, MAX_IMAGES);
      // Load the picked images CONCURRENTLY, not one-at-a-time. The old
      // sequential `await` loop meant the slideshow couldn't appear until the
      // first image had fully downloaded (and couldn't cross-fade until the
      // second) — long enough that the opening scene could arrive first and the
      // loader would vanish before any art ever showed. Firing all fetches at
      // once makes the first frames appear near-instantly; each blob is appended
      // the moment it resolves, and a failed fetch is dropped, never shown.
      await Promise.all(
        picked.map(async (ref) => {
          try {
            const blob = await fetchImageBlob(
              connection,
              `/campaigns/${encodeURIComponent(ref.campaignId)}/images/${encodeURIComponent(ref.filename)}`
            );
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            created.push(url);
            setUrls((prev) => [...prev, url]);
          } catch {
            // skip an image that won't load
          }
        })
      );
    })();
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [connection, campaignId]);

  // Advance every DISPLAY_MS once at least two images are loaded. We move the
  // hidden layer to the next position, then flip which layer is active so the
  // new image dissolves in over the old one.
  useEffect(() => {
    if (urls.length < 2) return;
    const timer = setInterval(() => {
      setActive((cur) => {
        const hidden = cur === 0 ? 1 : 0;
        const next = nextPosRef.current % urls.length;
        nextPosRef.current = next + 1;
        setLayers((prev) => {
          const updated: [number, number] = [prev[0], prev[1]];
          updated[hidden] = next;
          return updated;
        });
        return hidden;
      });
    }, DISPLAY_MS);
    return () => clearInterval(timer);
  }, [urls.length]);

  if (urls.length === 0) return null;

  const layerStyle = (layerIndex: 0 | 1): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    // Issue #140: the active image was barely perceptible (0.32) beneath the
    // heavy scrim below, so the slideshow read as "not there". Raised so the
    // artwork is clearly visible while the centred ember + text stay legible.
    opacity: active === layerIndex ? 0.5 : 0,
    transition: `opacity ${FADE_MS}ms ease-in-out`,
    animation: `slideshowDrift ${DISPLAY_MS + FADE_MS}ms ease-out both`,
    // Restart the slow drift each time this layer becomes active.
    animationPlayState: active === layerIndex ? "running" : "paused",
  });

  return (
    <div
      aria-hidden="true"
      data-testid="loading-slideshow"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        borderRadius: "inherit",
        pointerEvents: "none",
      }}
    >
      <img key={`a-${layers[0]}`} src={urls[layers[0]] ?? urls[0]} alt="" style={layerStyle(0)} />
      <img key={`b-${layers[1]}`} src={urls[layers[1]] ?? urls[0]} alt="" style={layerStyle(1)} />
      {/* Scrim: darken toward the edges and keep the centre readable so the
          ember + "Weaving…" text on top always stays legible. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          // Issue #140: lightened from 0.55/0.72/0.88 so the art shows through
          // instead of being smothered, while keeping the centre dark enough
          // that the light-cream loader text stays readable.
          background:
            "radial-gradient(120% 100% at 50% 45%, rgba(20,14,10,0.40) 0%, rgba(20,14,10,0.52) 55%, rgba(20,14,10,0.70) 100%)",
        }}
      />
    </div>
  );
}
