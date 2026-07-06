import { useEffect, useMemo, useState } from "react";
import type { Connection } from "../lib/connection";
import { useAuthedImage } from "../lib/useAuthedImage";
import { buildGallery, type GalleryItem } from "../lib/gallery";
import { illustrateEntity, type CharacterSheet } from "../lib/campaign";

interface GalleryPanelProps {
  connection: Connection;
  campaignId: string;
  characterSheet: CharacterSheet;
  npcRoster: string;
  worldState: string;
  /** Called after a successful on-demand illustration so Play can re-fetch
   * state and the newly-recorded image shows up (ADR-0009). */
  onIllustrated: () => void;
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
  onIllustrated,
}: {
  connection: Connection;
  campaignId: string;
  item: GalleryItem;
  onOpen: (item: GalleryItem, url: string) => void;
  onLoadedChange: (loaded: boolean) => void;
  onIllustrated: () => void;
}) {
  // Issue #66: a local cache-bust so a regenerated entity image (same
  // deterministic filename) actually refreshes in the tile and lightbox.
  const [nonce, setNonce] = useState(0);
  const { url, status } = useAuthedImage(connection, campaignId, item.image, nonce);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  // Issue #66: regenerate affordance for an already-drawn entity, optionally
  // with a refined prompt appended to the entity's base description.
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenDraft, setRegenDraft] = useState("");

  async function draw(refine?: string) {
    setDrawing(true);
    setDrawError(null);
    const base = item.description || item.name;
    const description = refine?.trim() ? `${base}. ${refine.trim()}` : base;
    try {
      const result = await illustrateEntity(connection, campaignId, item.type, item.name, description);
      if (result.ok) {
        setNonce((n) => n + 1);
        onIllustrated();
      } else {
        setDrawError(result.error || "Grok Build couldn't draw this.");
      }
    } catch (err) {
      setDrawError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawing(false);
    }
  }

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
      <div style={{ position: "relative", borderRadius: 2, overflow: "hidden", height: 110, boxShadow: "0 4px 10px rgba(0,0,0,.5), 0 0 0 1px rgba(184,150,90,.4)" }}>
        <button
          data-testid="gallery-tile"
          onClick={() => onOpen(item, url)}
          style={{ padding: 0, border: "none", cursor: "pointer", background: "none", textAlign: "left", display: "block", width: "100%", height: "100%" }}
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
        {/* Issue #66: regenerate this likeness (optionally refined). */}
        <button
          data-testid="gallery-regenerate"
          title="Regenerate this image"
          onClick={() => setRegenOpen(true)}
          disabled={drawing}
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            width: 24,
            height: 24,
            borderRadius: "50%",
            border: "1px solid rgba(211,112,60,.6)",
            background: "rgba(8,5,3,.6)",
            color: drawing ? "var(--ink-faint)" : "var(--ember)",
            cursor: drawing ? "default" : "pointer",
            fontSize: 12,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {drawing ? "…" : "↻"}
        </button>
        {regenOpen && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(8,5,3,.9)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <textarea
              value={regenDraft}
              onChange={(e) => setRegenDraft(e.target.value)}
              data-testid="gallery-regenerate-input"
              placeholder="Optional refinement, then Redraw"
              style={{ flex: 1, width: "100%", boxSizing: "border-box", background: "rgba(12,8,5,.6)", border: "1px solid rgba(109,90,56,.5)", borderRadius: 3, padding: "5px 7px", color: "var(--ink)", fontFamily: "var(--font-body)", fontSize: 11, resize: "none", outline: "none" }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                data-testid="gallery-regenerate-submit"
                onClick={() => { draw(regenDraft); setRegenOpen(false); setRegenDraft(""); }}
                disabled={drawing}
                style={{ flex: 1, cursor: "pointer", padding: "5px 0", borderRadius: 3, border: "none", background: "linear-gradient(180deg,#d8743e,#a8511f)", color: "#1c120a", fontFamily: "var(--font-display)", fontSize: 10.5 }}
              >
                Redraw
              </button>
              <button
                onClick={() => { setRegenOpen(false); setRegenDraft(""); }}
                style={{ flex: 1, cursor: "pointer", padding: "5px 0", borderRadius: 3, border: "1px solid rgba(109,90,56,.5)", background: "transparent", color: "var(--ink-dim)", fontFamily: "var(--font-display)", fontSize: 10.5 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {drawError && (
          <div data-testid="gallery-draw-error" style={{ position: "absolute", left: 6, right: 6, bottom: 6, fontSize: 9.5, color: "var(--ember)", background: "rgba(8,5,3,.85)", borderRadius: 3, padding: "3px 5px", lineHeight: 1.3 }}>
            {drawError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="gallery-tile-empty"
      style={{
        minHeight: 110,
        borderRadius: 2,
        background: "rgba(20,12,6,.35)",
        border: "1px dashed rgba(109,90,56,.4)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "10px 8px",
      }}
    >
      <div style={{ fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: 1, color: "var(--ink-faint)", opacity: 0.7 }}>
        {item.type.toUpperCase()}
      </div>
      <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 11, color: "var(--ink-faint)", marginTop: 3, lineHeight: 1.3 }}>
        {item.name}
      </div>
      <div style={{ fontSize: 9, color: "var(--ink-faint)", opacity: 0.6, marginTop: 5 }}>— no likeness —</div>
      <button
        data-testid="gallery-draw"
        onClick={() => draw()}
        disabled={drawing}
        style={{
          marginTop: 7,
          cursor: drawing ? "default" : "pointer",
          padding: "5px 11px",
          borderRadius: 20,
          background: drawing ? "rgba(28,20,12,.5)" : "rgba(124,61,32,.28)",
          border: "1px solid rgba(211,112,60,.5)",
          color: drawing ? "var(--ink-faint)" : "var(--ember)",
          fontFamily: "var(--font-display)",
          fontSize: 10,
          letterSpacing: 0.5,
        }}
      >
        {drawing ? "Drawing…" : "✎ Draw this"}
      </button>
      {drawError && (
        <div data-testid="gallery-draw-error" style={{ fontSize: 9.5, color: "var(--ember)", marginTop: 5, lineHeight: 1.3 }}>
          {drawError}
        </div>
      )}
    </div>
  );
}

/** Per docs/design/handoff-2026-07/README.md: "the empty state dominating
 * the grid is intentional and correct" — most entities are never drawn,
 * especially early in a campaign or with image generation off, so this
 * always renders one tile per known entity (character/NPC/location)
 * rather than collapsing down to a single "nothing here" message the way
 * Folk/Quest do when they have zero entries at all. */
export function GalleryPanel({ connection, campaignId, characterSheet, npcRoster, worldState, onIllustrated }: GalleryPanelProps) {
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
        {illustratedCount} of {items.length} illustrated · tap “Draw this” to illustrate one
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
            onIllustrated={onIllustrated}
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
