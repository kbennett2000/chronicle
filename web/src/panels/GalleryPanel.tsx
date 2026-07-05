import { useEffect, useMemo, useState } from "react";
import type { Connection } from "../lib/connection";
import { useAuthedImage } from "../lib/useAuthedImage";
import { buildGallery, type GalleryItem } from "../lib/gallery";
import type { CharacterSheet } from "../lib/campaign";

interface GalleryPanelProps {
  connection: Connection;
  campaignId: string;
  characterSheet: CharacterSheet;
  npcRoster: string;
  worldState: string;
}

interface LightboxState {
  item: GalleryItem;
  url: string;
}

function GalleryTile({
  connection,
  campaignId,
  item,
  onOpen,
  onLoadedChange,
}: {
  connection: Connection;
  campaignId: string;
  item: GalleryItem;
  onOpen: (item: GalleryItem, url: string) => void;
  onLoadedChange: (loaded: boolean) => void;
}) {
  const { url, status } = useAuthedImage(connection, campaignId, item.image);

  // Reported so the "N of M illustrated" header counts images that
  // actually resolved, not just entities with a filename recorded — a
  // recorded-but-missing file (Slice 23's sabotage case) renders the same
  // clean empty tile as no reference at all, and should count the same
  // way too.
  useEffect(() => {
    onLoadedChange(status === "loaded");
  }, [status, onLoadedChange]);

  if (item.image && url) {
    return (
      <button
        data-testid="gallery-tile"
        onClick={() => onOpen(item, url)}
        style={{
          padding: 0,
          border: "none",
          cursor: "pointer",
          background: "none",
          textAlign: "left",
          position: "relative",
          borderRadius: 2,
          overflow: "hidden",
          height: 110,
          boxShadow: "0 4px 10px rgba(0,0,0,.5), 0 0 0 1px rgba(184,150,90,.4)",
        }}
      >
        <img
          src={url}
          alt=""
          data-testid="gallery-image"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(0,0,0,0) 55%,rgba(8,5,3,.72))" }} />
        <div style={{ position: "absolute", left: 7, right: 7, bottom: 6 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: 1, color: "var(--arcane)" }}>
            {item.type.toUpperCase()}
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "#f2e8d6", lineHeight: 1.2 }}>{item.name}</div>
        </div>
      </button>
    );
  }

  return (
    <div
      data-testid="gallery-tile-empty"
      style={{
        height: 110,
        borderRadius: 2,
        background: "rgba(20,12,6,.35)",
        border: "1px dashed rgba(109,90,56,.4)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "0 8px",
      }}
    >
      <div style={{ fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: 1, color: "var(--ink-faint)", opacity: 0.7 }}>
        {item.type.toUpperCase()}
      </div>
      <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 11, color: "var(--ink-faint)", marginTop: 3, lineHeight: 1.3 }}>
        {item.name}
      </div>
      <div style={{ fontSize: 9, color: "var(--ink-faint)", opacity: 0.6, marginTop: 5 }}>— no likeness —</div>
    </div>
  );
}

/** Per docs/design/handoff-2026-07/README.md: "the empty state dominating
 * the grid is intentional and correct" — most entities are never drawn,
 * especially early in a campaign or with image generation off, so this
 * always renders one tile per known entity (character/NPC/location)
 * rather than collapsing down to a single "nothing here" message the way
 * Folk/Quest do when they have zero entries at all. */
export function GalleryPanel({ connection, campaignId, characterSheet, npcRoster, worldState }: GalleryPanelProps) {
  const items = useMemo(
    () => buildGallery(characterSheet, npcRoster, worldState),
    [characterSheet, npcRoster, worldState]
  );
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [loadedFlags, setLoadedFlags] = useState<Record<number, boolean>>({});

  const illustratedCount = Object.values(loadedFlags).filter(Boolean).length;

  return (
    <div>
      <div data-testid="gallery-count" style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 12 }}>
        {illustratedCount} of {items.length} illustrated · most faces and places are never drawn
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {items.map((item, i) => (
          <GalleryTile
            key={`${item.type}-${item.name}-${i}`}
            connection={connection}
            campaignId={campaignId}
            item={item}
            onOpen={(openedItem, url) => setLightbox({ item: openedItem, url })}
            onLoadedChange={(loaded) =>
              setLoadedFlags((prev) => (prev[i] === loaded ? prev : { ...prev, [i]: loaded }))
            }
          />
        ))}
      </div>

      {lightbox && (
        <div
          data-testid="gallery-lightbox"
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(4,2,1,.9)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            // Per the handoff's motion catalog: fadeIn .25s on overlays —
            // every other overlay (sheet-scrim, BottomSheet) already gets
            // this via its own CSS class; the lightbox was the one overlay
            // still snapping in with no transition at all.
            animation: "fadeIn 0.25s ease",
            padding: 24,
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 480,
              borderRadius: 2,
              overflow: "hidden",
              boxShadow: "0 20px 50px rgba(0,0,0,.7), 0 0 0 1px rgba(184,150,90,.5)",
            }}
          >
            <img src={lightbox.url} alt="" data-testid="lightbox-image" style={{ width: "100%", display: "block" }} />
          </div>
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 2, color: "var(--arcane)" }}>
              {lightbox.item.type.toUpperCase()}
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, letterSpacing: 0.6, color: "var(--ink)", marginTop: 2 }}>
              {lightbox.item.name}
            </div>
          </div>
          <div style={{ marginTop: 16, fontSize: 11, color: "var(--ink-faint)" }}>tap anywhere to close</div>
        </div>
      )}
    </div>
  );
}
