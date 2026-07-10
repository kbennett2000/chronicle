import { useEffect, useRef, useState } from "react";
import type { Connection } from "../lib/connection";
import {
  getState,
  sendTurn,
  editTurn,
  generateOpening,
  illustrateMoment,
  animateMoment,
  getCampaignSettings,
  type CharacterSheet,
  type StateSnapshot,
} from "../lib/campaign";
import { useAuthedImage } from "../lib/useAuthedImage";
import { useAuthedVideo } from "../lib/useAuthedVideo";
import { parseChapterHeadings } from "../lib/session-log";
import { BottomSheet } from "../components/BottomSheet";
import { SelfPanel } from "../panels/SelfPanel";
import { CharacterSheetFull } from "../panels/CharacterSheetFull";
import { FolkPanel } from "../panels/FolkPanel";
import { QuestPanel } from "../panels/QuestPanel";
import { GalleryPanel } from "../panels/GalleryPanel";
import { LoadingSlideshow } from "../components/LoadingSlideshow";
import { loadMuted, saveMuted } from "../lib/mute";
import { useMusicPlayer } from "../lib/music";
import { GameMusicPopover } from "../components/GameMusicPopover";
import { useIsDesktop } from "../lib/useIsDesktop";

interface PlayProps {
  connection: Connection;
  campaignId: string;
  onGoHome: () => void;
  /** #114: open this game's in-game settings screen (the header gear). */
  onOpenSettings: () => void;
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

/** One player message + its (eventual) DM response. `narration: null`
 * means the turn is still in flight — per ADR-0007 this is built from
 * currentSessionLog.transcript (hydration) and sendTurn's own result
 * (live), never from parsing the prose log. */
interface DisplayTurn {
  playerMessage: string;
  narration: string | null;
  isError?: boolean;
  /** ADR-0009: the scene image a user illustrated for this moment, if any. */
  image?: string;
  /** Issue #118: the clip a user animated for this moment, if any. */
  video?: string;
  /** ADR-0030 (#132): the DM-emitted caption that made this moment's image,
   * used to pre-fill the regenerate box. Absent on old, pre-caption turns. */
  sceneCaption?: string;
}

const TABS = ["Self", "Folk", "Quest", "Views"] as const;
type Tab = (typeof TABS)[number];

/** Issues #38–#41: each drawer opened with only a bare title, leaving
 * players unsure what it was for. One plain-language line per panel. */
const TAB_SUBTITLES: Record<Tab, string> = {
  Self: "Your character — stats, gear, and coin.",
  Folk: "People you've met, and what they know.",
  Quest: "What you're chasing, and what you've resolved.",
  Views: "Portraits and scenes from your tale. Tap “Draw this” to illustrate one.",
};

function ChapterHeading({ text }: { text: string }) {
  return (
    <div style={{ textAlign: "center", margin: "2px 0 20px" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2.5, color: "var(--brass-dim)" }}>
        {text}
      </div>
      <div
        style={{
          height: 1,
          width: 60,
          margin: "8px auto 0",
          background: "linear-gradient(90deg,transparent,var(--brass-dim),transparent)",
        }}
      />
    </div>
  );
}

/** Renders a moment's illustrated scene as an authed blob image; nothing
 * while it can't resolve (same graceful-empty contract as the gallery). */
function MomentImage({ connection, campaignId, filename, cacheBust }: { connection: Connection; campaignId: string; filename: string; cacheBust?: number }) {
  const { url } = useAuthedImage(connection, campaignId, filename, cacheBust);
  const [expanded, setExpanded] = useState(false);
  if (!url) return null;
  return (
    <>
      {/* Issue #52: scenes used to render full width with no cap, dominating
          the screen. Bound the inline size; tap to view full. */}
      <img
        src={url}
        alt=""
        data-testid="moment-image"
        onClick={() => setExpanded(true)}
        style={{
          display: "block",
          width: "auto",
          maxWidth: "100%",
          maxHeight: 340,
          borderRadius: 3,
          margin: "0 0 16px",
          cursor: "zoom-in",
          boxShadow: "0 6px 16px rgba(0,0,0,.5), 0 0 0 1px rgba(184,150,90,.4)",
        }}
      />
      {expanded && (
        <div
          data-testid="moment-lightbox"
          onClick={() => setExpanded(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(4,2,1,.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            cursor: "zoom-out",
            animation: "fadeIn 0.25s ease",
          }}
        >
          <img
            src={url}
            alt=""
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              borderRadius: 2,
              boxShadow: "0 20px 50px rgba(0,0,0,.7), 0 0 0 1px rgba(184,150,90,.5)",
            }}
          />
        </div>
      )}
    </>
  );
}

/** Issue #118: a moment's animated clip. Loop + muted + inline so it behaves
 * like an ambient motion still rather than a video the player must manage;
 * controls are available for scrubbing. Nothing renders until it resolves. */
function MomentVideo({ connection, campaignId, filename, cacheBust }: { connection: Connection; campaignId: string; filename: string; cacheBust?: number }) {
  const { url } = useAuthedVideo(connection, campaignId, filename, cacheBust);
  if (!url) return null;
  return (
    <video
      src={url}
      data-testid="moment-video"
      controls
      loop
      muted
      playsInline
      style={{
        display: "block",
        width: "auto",
        maxWidth: "100%",
        maxHeight: 340,
        borderRadius: 3,
        margin: "0 0 16px",
        boxShadow: "0 6px 16px rgba(0,0,0,.5), 0 0 0 1px rgba(184,150,90,.4)",
      }}
    />
  );
}

function TurnView({
  turn,
  connection,
  campaignId,
  onIllustrate,
  drawing,
  drawError,
  imageNonce,
  generateVideos,
  onAnimate,
  animating,
  animateError,
  videoNonce,
  onEdit,
  canEdit,
  editing,
  editError,
  discardCount,
}: {
  turn: DisplayTurn;
  connection: Connection;
  campaignId: string;
  // Issue #66: an optional prompt override lets the player refine a regenerate.
  onIllustrate: (description?: string) => void;
  drawing: boolean;
  drawError: string | null;
  imageNonce?: number;
  // Issue #118: on-demand "Animate" state, parallel to the illustrate props.
  generateVideos?: boolean;
  onAnimate: (description?: string) => void;
  animating: boolean;
  animateError: string | null;
  videoNonce?: number;
  // Issue #68: edit this player message and re-run from here.
  onEdit: (newMessage: string) => void;
  canEdit: boolean;
  editing: boolean;
  editError: string | null;
  discardCount: number;
}) {
  // A moment can be illustrated once it has real (non-error) narration and
  // has been persisted server-side (i.e. it's a settled turn, not the one
  // still weaving). Already-illustrated moments show the image instead.
  const canIllustrate = turn.narration !== null && !turn.isError;
  // Issue #66: regenerate affordance for an already-drawn moment — optionally
  // with a refined prompt. Collapsed by default so it doesn't clutter the log.
  const [regenOpen, setRegenOpen] = useState(false);
  // #132: pre-fill the regenerate box with the caption that made the current
  // image (the turn's stored sceneCaption) so the player tweaks it (e.g.
  // "…at night") instead of retyping. Blank on old, pre-caption turns.
  const [regenDraft, setRegenDraft] = useState(turn.sceneCaption ?? "");
  // Issue #68: inline edit of this turn's player message.
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState(turn.playerMessage);
  const isOpening = turn.playerMessage.trim() === "";

  function submitEdit(text: string) {
    const warning =
      discardCount > 0
        ? `This will re-run this turn and discard the ${discardCount} turn${discardCount === 1 ? "" : "s"} after it. This can't be undone. Continue?`
        : "This will re-run this turn with your edited action. Continue?";
    if (!window.confirm(warning)) return;
    setEditOpen(false);
    onEdit(text);
  }
  return (
    <>
      {/* ADR-0013: a turn-zero opening scene has an empty playerMessage (the DM
          spoke unprompted) — render narration alone, with no "YOU" block. */}
      {turn.playerMessage.trim() !== "" && (
        <div style={{ margin: "0 0 16px", paddingLeft: 12, borderLeft: "2px solid var(--ember-deep)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 2, color: "var(--ember)", marginBottom: 2 }}>
              YOU
            </div>
            {/* Issue #68: edit this action and re-run from here. */}
            {canEdit && !editOpen && (
              <button
                data-testid="edit-turn"
                onClick={() => { setEditDraft(turn.playerMessage); setEditOpen(true); }}
                disabled={editing}
                style={{ background: "none", border: "none", cursor: editing ? "default" : "pointer", fontSize: 10.5, color: "var(--brass)", padding: 0, fontFamily: "var(--font-display)", letterSpacing: 0.5 }}
              >
                ✎ Edit
              </button>
            )}
          </div>
          {editOpen ? (
            <div>
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                data-testid="edit-turn-input"
                rows={2}
                autoFocus
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(12,8,5,.5)", border: "1px solid rgba(109,90,56,.4)", borderRadius: 4, padding: "8px 11px", color: "var(--ink)", fontFamily: "var(--font-body)", fontSize: 15, resize: "vertical", outline: "none" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  data-testid="edit-turn-save"
                  onClick={() => submitEdit(editDraft)}
                  disabled={editing || editDraft.trim() === ""}
                  style={{ cursor: editing ? "default" : "pointer", padding: "6px 14px", borderRadius: 3, border: "none", background: "linear-gradient(180deg,#d8743e,#a8511f)", color: "#1c120a", fontFamily: "var(--font-display)", fontSize: 11.5, opacity: editing || editDraft.trim() === "" ? 0.6 : 1 }}
                >
                  Save & re-run
                </button>
                <button
                  onClick={() => setEditOpen(false)}
                  disabled={editing}
                  style={{ cursor: "pointer", padding: "6px 14px", borderRadius: 3, border: "1px solid rgba(109,90,56,.4)", background: "transparent", color: "var(--ink-dim)", fontFamily: "var(--font-display)", fontSize: 11.5 }}
                >
                  Cancel
                </button>
              </div>
              {discardCount > 0 && (
                <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 4, lineHeight: 1.35 }}>
                  Re-running discards the {discardCount} turn{discardCount === 1 ? "" : "s"} after this one.
                </div>
              )}
            </div>
          ) : (
            <div
              data-testid="player-message"
              style={{ fontSize: 15, lineHeight: 1.55, fontStyle: "italic", color: "var(--ink-dim)" }}
            >
              {turn.playerMessage}
            </div>
          )}
          {editError && (
            <div data-testid="edit-turn-error" style={{ fontSize: 11, color: "var(--ember)", marginTop: 4 }}>
              {editError}
            </div>
          )}
        </div>
      )}
      {turn.narration !== null && (
        <p
          data-testid="narration"
          style={{
            margin: "0 0 16px",
            fontSize: 16,
            lineHeight: 1.64,
            color: turn.isError ? "var(--ember)" : "var(--ink)",
            whiteSpace: "pre-wrap",
          }}
        >
          {turn.narration}
        </p>
      )}
      {/* Issue #68: turn-zero opening has no YOU block — offer a reweave that
          re-runs the opening scene, discarding everything after it. */}
      {isOpening && canEdit && turn.narration !== null && (
        <div style={{ margin: "-6px 0 18px" }}>
          <button
            data-testid="reweave-opening"
            onClick={() => submitEdit("")}
            disabled={editing}
            style={{ background: "none", border: "none", cursor: editing ? "default" : "pointer", padding: 0, color: editing ? "var(--ink-faint)" : "var(--brass)", fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 0.5 }}
          >
            ↺ Reweave the opening
          </button>
          {editError && (
            <div data-testid="edit-turn-error" style={{ fontSize: 11, color: "var(--ember)", marginTop: 4 }}>
              {editError}
            </div>
          )}
        </div>
      )}
      {turn.image && <MomentImage connection={connection} campaignId={campaignId} filename={turn.image} cacheBust={imageNonce} />}
      {turn.video && <MomentVideo connection={connection} campaignId={campaignId} filename={turn.video} cacheBust={videoNonce} />}
      {canIllustrate && !turn.image && (
        <div style={{ margin: "-6px 0 18px" }}>
          <button
            data-testid="illustrate-moment"
            onClick={() => onIllustrate()}
            disabled={drawing}
            style={{
              cursor: drawing ? "default" : "pointer",
              background: "none",
              border: "none",
              padding: 0,
              color: drawing ? "var(--ink-faint)" : "var(--brass)",
              fontFamily: "var(--font-display)",
              fontSize: 11,
              letterSpacing: 0.5,
            }}
          >
            {drawing ? "Illustrating…" : "⟢ Illustrate this moment"}
          </button>
          {drawError && (
            <div data-testid="illustrate-error" style={{ fontSize: 11, color: "var(--ember)", marginTop: 4 }}>
              {drawError}
            </div>
          )}
        </div>
      )}
      {/* Issue #66: regenerate an existing moment image, optionally with a
          refined prompt. Server overwrites the deterministic filename; the
          parent bumps imageNonce so the new picture actually shows. */}
      {canIllustrate && turn.image && (
        <div style={{ margin: "-6px 0 18px" }}>
          {!regenOpen ? (
            <button
              data-testid="regenerate-moment"
              onClick={() => { setRegenDraft(turn.sceneCaption ?? ""); setRegenOpen(true); }}
              disabled={drawing}
              style={{
                cursor: drawing ? "default" : "pointer",
                background: "none",
                border: "none",
                padding: 0,
                color: drawing ? "var(--ink-faint)" : "var(--brass)",
                fontFamily: "var(--font-display)",
                fontSize: 11,
                letterSpacing: 0.5,
              }}
            >
              {drawing ? "Redrawing…" : "↻ Regenerate image"}
            </button>
          ) : (
            <div>
              <textarea
                value={regenDraft}
                onChange={(e) => setRegenDraft(e.target.value)}
                data-testid="regenerate-input"
                rows={2}
                placeholder="Optional: describe changes (e.g. at dusk, wider shot). Leave blank to just redraw."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "rgba(12,8,5,.5)",
                  border: "1px solid rgba(109,90,56,.4)",
                  borderRadius: 4,
                  padding: "8px 11px",
                  color: "var(--ink)",
                  fontFamily: "var(--font-body)",
                  fontSize: 13,
                  resize: "vertical",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  data-testid="regenerate-submit"
                  onClick={() => { onIllustrate(regenDraft); setRegenOpen(false); setRegenDraft(""); }}
                  disabled={drawing}
                  style={{ cursor: drawing ? "default" : "pointer", padding: "6px 14px", borderRadius: 3, border: "none", background: "linear-gradient(180deg,#d8743e,#a8511f)", color: "#1c120a", fontFamily: "var(--font-display)", fontSize: 11.5, opacity: drawing ? 0.6 : 1 }}
                >
                  Redraw
                </button>
                <button
                  onClick={() => { setRegenOpen(false); setRegenDraft(""); }}
                  disabled={drawing}
                  style={{ cursor: "pointer", padding: "6px 14px", borderRadius: 3, border: "1px solid rgba(109,90,56,.4)", background: "transparent", color: "var(--ink-dim)", fontFamily: "var(--font-display)", fontSize: 11.5 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {drawError && (
            <div data-testid="illustrate-error" style={{ fontSize: 11, color: "var(--ember)", marginTop: 4 }}>
              {drawError}
            </div>
          )}
        </div>
      )}
      {/* Issue #118: animate this moment into a clip (opt-in). The server feeds
          the moment's own still to /imagine-video for continuity, so this reads
          best after illustrating — but works without a still too. */}
      {generateVideos && canIllustrate && (
        <div style={{ margin: "-6px 0 18px" }}>
          <button
            data-testid="animate-moment"
            onClick={() => onAnimate()}
            disabled={animating}
            style={{
              cursor: animating ? "default" : "pointer",
              background: "none",
              border: "none",
              padding: 0,
              color: animating ? "var(--ink-faint)" : "var(--arcane)",
              fontFamily: "var(--font-display)",
              fontSize: 11,
              letterSpacing: 0.5,
            }}
          >
            {animating ? "Animating…" : turn.video ? "🎬 Re-animate this moment" : "🎬 Animate this moment"}
          </button>
          {animateError && (
            <div data-testid="animate-error" style={{ fontSize: 11, color: "var(--arcane)", marginTop: 4 }}>
              {animateError}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Issue #59: a brand-new game's opening scene is a full DM turn that can take
 * many seconds. The old tiny top-left "setting the scene…" line on an otherwise
 * empty parchment left players unsure anything was happening. This is a
 * prominent, centered, reassuring state used only for the turn-zero opening. */
function OpeningSceneLoader({ connection, campaignId }: { connection: Connection; campaignId: string }) {
  return (
    <div
      data-testid="opening-loader"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        minHeight: "60vh",
        gap: 18,
        padding: "0 24px",
        overflow: "hidden",
        borderRadius: 12,
      }}
    >
      {/* Issue #105: a soft slideshow of the player's past-game art, behind the
          loader. Renders nothing for a player with no prior images. */}
      <LoadingSlideshow connection={connection} campaignId={campaignId} />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div
          style={{
            width: 22,
            height: 32,
            background: "var(--ember)",
            borderRadius: "50% 50% 50% 0",
            transform: "rotate(-45deg)",
            animation: "flicker 2.2s ease-in-out infinite",
            boxShadow: "0 0 26px 6px rgba(211,112,60,.35)",
          }}
        />
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 17,
            letterSpacing: 1,
            color: "var(--ink)",
          }}
        >
          Weaving the opening of your tale
          <span style={{ animation: "dotPulse 1.4s infinite" }}>.</span>
          <span style={{ animation: "dotPulse 1.4s infinite .2s" }}>.</span>
          <span style={{ animation: "dotPulse 1.4s infinite .4s" }}>.</span>
        </div>
        <div style={{ fontSize: 13, fontStyle: "italic", color: "var(--ink-faint)", maxWidth: 340, lineHeight: 1.5 }}>
          The Dungeon Master is setting the scene. This can take a moment as your
          world takes shape — no need to do anything yet.
        </div>
      </div>
    </div>
  );
}

function WeavingIndicator({ label = "The Dungeon Master is weaving what happens next" }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, margin: "2px 0 10px", opacity: 0.92 }}>
      <div
        style={{
          width: 10,
          height: 15,
          background: "var(--ember)",
          borderRadius: "50% 50% 50% 0",
          transform: "rotate(-45deg)",
          animation: "flicker 2.2s ease-in-out infinite",
          flexShrink: 0,
        }}
      />
      <span style={{ fontStyle: "italic", fontSize: 14.5, color: "var(--ink-dim)" }}>
        {label}
        <span style={{ animation: "dotPulse 1.4s infinite" }}>.</span>
        <span style={{ animation: "dotPulse 1.4s infinite .2s" }}>.</span>
        <span style={{ animation: "dotPulse 1.4s infinite .4s" }}>.</span>
      </span>
    </div>
  );
}

/** Chapter framing (from the prose log) and turn-by-turn player/narration
 * content (from currentSessionLog.transcript) are two independent data
 * sources per ADR-0007 — composing them is just "render the chapter
 * heading(s), then every turn in order," since a session's prose log has
 * exactly one heading for the one transcript it corresponds to. Image
 * reveals and the HP wax-note are out of scope this slice. */
// Shown when a panel is selected before its data has loaded (e.g. Self/Views
// before the character sheet arrives). Preserves the prior bottom-sheet copy.
function PanelPending({ label }: { label: string }) {
  return (
    <p style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 15, textAlign: "center", marginTop: 40 }}>
      {label} panel — coming soon
    </p>
  );
}

export function Play({ connection, campaignId, onGoHome, onOpenSettings }: PlayProps) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [chapters, setChapters] = useState<string[]>([]);
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // ADR-0013: turn-zero opening-scene generation. `openingScene` is true while
  // the DM is writing the first beat of a brand-new campaign; `openingError`
  // holds a reason if it couldn't (the player then just types to begin). The
  // ref makes the auto-trigger fire at most once per mount even though the
  // effect re-runs as turns/load change (the server is idempotent regardless).
  const [openingScene, setOpeningScene] = useState(false);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const openingFiredRef = useRef(false);
  const [openTab, setOpenTab] = useState<Tab | null>(null);
  // Per-turn illustration state (ADR-0009): which turn index is currently
  // generating, and any error to show under that turn's button.
  const [illustratingTurn, setIllustratingTurn] = useState<number | null>(null);
  const [illustrateErrors, setIllustrateErrors] = useState<Record<number, string>>({});
  // Issue #66: per-turn cache-bust counter. A regenerated moment reuses the same
  // deterministic filename, so bumping this forces useAuthedImage (and the
  // browser's HTTP cache) to fetch the freshly-drawn picture instead of the old.
  const [imageNonces, setImageNonces] = useState<Record<number, number>>({});
  // Issue #118: per-turn "Animate" state, mirroring the illustrate state above.
  const [animatingTurn, setAnimatingTurn] = useState<number | null>(null);
  const [animateErrors, setAnimateErrors] = useState<Record<number, string>>({});
  const [videoNonces, setVideoNonces] = useState<Record<number, number>>({});
  // Issue #118: opt-in toggle that reveals the "Animate" affordances (needs Grok).
  const [generateVideos, setGenerateVideos] = useState(false);
  // Issue #68: which turn is being edited+re-run (null when none), and any error
  // (tagged with its turn index so it survives editingTurn resetting to null).
  const [editingTurn, setEditingTurn] = useState<number | null>(null);
  const [editError, setEditError] = useState<{ index: number; message: string } | null>(null);
  // Issue #56: whether each turn should auto-illustrate. Held in a ref so
  // handleSend/generateOpening read the current value without being re-created
  // or racing a state update.
  const autoIllustrateRef = useRef(false);
  const [characterSheet, setCharacterSheet] = useState<CharacterSheet | null>(null);
  const [npcRoster, setNpcRoster] = useState<string>("");
  const [questLog, setQuestLog] = useState<string>("");
  const [worldState, setWorldState] = useState<string>("");
  const [muted, setMuted] = useState(() => loadMuted());
  const logEndRef = useRef<HTMLDivElement>(null);
  // ADR-0020: background music (local files or a Navidrome LAN playlist). The
  // hook owns its own Audio element + shuffled playlist; the mute button below
  // only shows when the user has music enabled.
  const music = useMusicPlayer(connection, muted, campaignId);

  // Self/Folk/Quest/Views all read these four fields as props — refreshed
  // after every turn (see handleSend) as well as on mount. A full played
  // session surfaced this the isolated per-panel Playwright specs never
  // could: every one of those seeds its fixture file straight to disk
  // before the page ever loads, so they only ever exercise the initial
  // fetch, never "a turn just changed this, does the already-open app
  // notice." Before this fix, these four were fetched once at mount and
  // never touched again — Folk/Quest/Views would show pre-session-start
  // data forever, even after turns that added NPCs/quests/locations.
  function applyPanelState(snapshot: StateSnapshot) {
    setCharacterSheet(snapshot.characterSheet);
    setNpcRoster(snapshot.npcRoster);
    setQuestLog(snapshot.questLog);
    setWorldState(snapshot.worldState);
  }

  // Issue #56: load campaign settings so we know whether to auto-illustrate
  // each turn. Best-effort — a failed fetch just leaves auto-illustration off.
  useEffect(() => {
    let cancelled = false;
    getCampaignSettings(connection, campaignId)
      .then((s) => {
        if (cancelled) return;
        autoIllustrateRef.current = Boolean(s.autoIllustrateTurns && s.generateImages);
        setGenerateVideos(Boolean(s.generateVideos));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connection, campaignId]);

  useEffect(() => {
    let cancelled = false;
    getState(connection, campaignId)
      .then((snapshot) => {
        if (cancelled) return;
        applyPanelState(snapshot);
        // A brand-new campaign has no currentSessionLog at all yet — a
        // real empty state (no turns taken), not an error.
        if (snapshot.currentSessionLog) {
          setChapters(parseChapterHeadings(snapshot.currentSessionLog.content));
          setTurns(
            snapshot.currentSessionLog.transcript.map((record) => ({
              playerMessage: record.playerMessage,
              narration: record.narration,
              image: record.image,
              video: record.video,
              sceneCaption: record.sceneCaption,
            }))
          );
        } else {
          setChapters([]);
          setTurns([]);
        }
        setLoad({ status: "ready" });
      })
      .catch((err) => {
        if (!cancelled) setLoad({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [connection, campaignId]);

  // ADR-0013 (issue #54): a brand-new campaign has zero turns, which used to
  // land the player on a blank "the tale hasn't begun" screen. Instead, the
  // first time we're ready with no turns, ask the DM to set the opening scene
  // (a turn-zero record with no player message), showing a "setting the scene"
  // state meanwhile. Fires once per mount (openingFiredRef); the server is
  // idempotent, so a reload/double-fire can't produce a second opening.
  useEffect(() => {
    // Fire once, when load first resolves. `turns.length` is deliberately NOT
    // a dependency: the success path calls setTurns, and if that re-ran this
    // effect its cleanup would cancel the in-flight .finally and leave the
    // input stuck disabled. openingFiredRef guards against any re-entry, and
    // the server is idempotent regardless.
    if (load.status !== "ready" || turns.length > 0 || openingFiredRef.current) return;
    openingFiredRef.current = true;
    let cancelled = false;
    setOpeningScene(true);
    setOpeningError(null);
    generateOpening(connection, campaignId)
      .then((result) => {
        if (cancelled) return;
        if (result.isError) {
          setOpeningError(result.narration || "The Dungeon Master couldn't set the scene.");
          return;
        }
        setTurns([{ playerMessage: "", narration: result.narration, sceneCaption: result.sceneCaption }]);
        // Current Situation / gear the opening just established need to reach
        // the Self/Views panels, same as after a normal turn.
        getState(connection, campaignId).then(applyPanelState).catch(() => {});
        // Issue #56: auto-illustrate the opening scene (turn 0) too, if on.
        // #146: `auto` so a caption-less opening skips instead of scavenging prose.
        if (autoIllustrateRef.current) {
          void handleIllustrateMoment(0, undefined, true);
        }
      })
      .catch((err) => {
        if (!cancelled) setOpeningError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setOpeningScene(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.status, connection, campaignId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns, sending, openingScene]);

  function toggleMute() {
    setMuted((prev) => {
      const next = !prev;
      saveMuted(next);
      return next;
    });
  }

  async function handleSend() {
    const message = input.trim();
    if (!message || sending) return;
    // The turn we're about to append lands at this index (array index === turn
    // index, same mapping the manual "Illustrate this moment" button uses).
    const newTurnIndex = turns.length;
    setTurns((prev) => [...prev, { playerMessage: message, narration: null }]);
    setInput("");
    setSending(true);
    try {
      const result = await sendTurn(connection, campaignId, message);
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = { playerMessage: message, narration: result.narration, isError: result.isError, sceneCaption: result.sceneCaption };
        return next;
      });
      // Whatever the DM just wrote (HP/inventory, a new NPC, quest
      // progress, a new location) needs to actually reach the panels that
      // read it — a successful turn without this would leave Self/Folk/
      // Quest/Views silently showing whatever was true before this turn.
      if (!result.isError) {
        getState(connection, campaignId)
          .then(applyPanelState)
          .catch(() => {
            // Panel data just stays at its last-known-good snapshot; the
            // turn itself already succeeded and is on screen.
          });
        // Issue #56: reply-first auto-illustration. The narration is already on
        // screen; kick off the same on-demand moment illustration a player can
        // trigger by hand. It's best-effort and single-flighted by
        // handleIllustrateMoment's own `illustratingTurn` guard.
        // #146: `auto` so a caption-less turn skips instead of scavenging prose.
        if (autoIllustrateRef.current) {
          void handleIllustrateMoment(newTurnIndex, undefined, true);
        }
      }
    } catch (err) {
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          playerMessage: message,
          narration: err instanceof Error ? err.message : String(err),
          isError: true,
        };
        return next;
      });
    } finally {
      setSending(false);
    }
  }

  // ADR-0009: illustrate a settled turn on demand. On success the server
  // persisted the path on the transcript record; we set it on the turn so it
  // renders immediately (and survives reload via hydration). On failure we
  // show the returned Grok reason under that turn, never a silent no-op.
  //
  // ADR-0030 race amendment (#146): `auto` marks the reply-first auto-illustrate
  // trigger. In auto mode the server SKIPS (never scavenges narration) when the
  // turn has no caption yet — that's not an error, so we show nothing and leave
  // the manual "Illustrate this moment" affordance for later. User-initiated
  // illustrate/regenerate leaves `auto` off (narration fallback preserved).
  async function handleIllustrateMoment(index: number, description?: string, auto = false) {
    if (illustratingTurn !== null) return;
    setIllustratingTurn(index);
    setIllustrateErrors((prev) => {
      const { [index]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      const result = await illustrateMoment(connection, campaignId, index, description, auto);
      if (result.ok && result.relPath) {
        const relPath = result.relPath;
        const caption = result.sceneCaption;
        // Set the image, and pick up the caption the server drew from so the
        // regenerate box prefills even if the turn payload predated it.
        setTurns((prev) =>
          prev.map((t, i) =>
            i === index ? { ...t, image: relPath, sceneCaption: caption ?? t.sceneCaption } : t
          )
        );
        // Bust the image cache so a regenerate (same filename) actually shows.
        setImageNonces((prev) => ({ ...prev, [index]: (prev[index] ?? 0) + 1 }));
      } else if (!result.skipped) {
        // A skip (auto, no caption yet) is a deliberate no-op, not a failure.
        setIllustrateErrors((prev) => ({ ...prev, [index]: result.error || "Grok Build couldn't draw this." }));
      }
    } catch (err) {
      setIllustrateErrors((prev) => ({ ...prev, [index]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIllustratingTurn(null);
    }
  }

  // Issue #118: animate a moment into a clip. Mirrors handleIllustrateMoment;
  // the server feeds the moment's own still (if any) to /imagine-video.
  async function handleAnimateMoment(index: number, description?: string) {
    if (animatingTurn !== null) return;
    setAnimatingTurn(index);
    setAnimateErrors((prev) => {
      const { [index]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      const result = await animateMoment(connection, campaignId, index, description);
      if (result.ok && result.relPath) {
        const relPath = result.relPath;
        setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, video: relPath } : t)));
        setVideoNonces((prev) => ({ ...prev, [index]: (prev[index] ?? 0) + 1 }));
      } else {
        setAnimateErrors((prev) => ({ ...prev, [index]: result.error || "Grok Build couldn't animate this." }));
      }
    } catch (err) {
      setAnimateErrors((prev) => ({ ...prev, [index]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setAnimatingTurn(null);
    }
  }

  // Re-fetch state after a gallery illustration so the newly-recorded portrait
  // reaches the panels that read it.
  function refreshPanels() {
    getState(connection, campaignId).then(applyPanelState).catch(() => {});
  }

  // Issue #68: after an edit re-runs the turn (which rewrote the transcript and
  // state files server-side), rebuild everything from the server — the same
  // hydration path the initial load uses, rather than surgically patching.
  async function reloadFromServer() {
    const snapshot = await getState(connection, campaignId);
    applyPanelState(snapshot);
    if (snapshot.currentSessionLog) {
      setChapters(parseChapterHeadings(snapshot.currentSessionLog.content));
      setTurns(
        snapshot.currentSessionLog.transcript.map((record) => ({
          playerMessage: record.playerMessage,
          narration: record.narration,
          image: record.image,
          video: record.video,
          sceneCaption: record.sceneCaption,
        }))
      );
    } else {
      setChapters([]);
      setTurns([]);
    }
  }

  // Issue #68: edit a past player message and re-run from there, discarding
  // everything after it. The caller (TurnView) has already confirmed the
  // discard. Optimistically drops the edited turn + all later ones and shows the
  // weaving indicator, then rebuilds from the server once the re-run lands.
  async function handleEditTurn(index: number, newMessage: string) {
    if (editingTurn !== null || sending || openingScene) return;
    setEditingTurn(index);
    setEditError(null);
    setTurns((prev) => prev.slice(0, index));
    try {
      await editTurn(connection, campaignId, index, newMessage);
      await reloadFromServer();
    } catch (err) {
      setEditError({ index, message: err instanceof Error ? err.message : String(err) });
      // Restore the pre-edit view so the player doesn't lose the log on error.
      await reloadFromServer().catch(() => {});
    } finally {
      setEditingTurn(null);
    }
  }

  // ADR-0021: on desktop the Self/Folk/Quest/Views panels dock into a persistent
  // side column instead of the mobile slide-up bottom sheet, so a panel is always
  // shown (defaulting to Self). On mobile, openTab stays null until a tab is
  // tapped. renderPanel() is shared by both containers so the panel bodies never
  // diverge between layouts.
  const isDesktop = useIsDesktop();
  const activeTab: Tab = openTab ?? "Self";

  function renderPanel(tab: Tab) {
    if (tab === "Self") {
      if (!characterSheet) return <PanelPending label="Self" />;
      // ADR-0022: desktop's wide side panel shows the full official sheet; mobile
      // keeps the compact collapsible SelfPanel.
      return isDesktop ? (
        <CharacterSheetFull connection={connection} campaignId={campaignId} sheet={characterSheet} onUpdated={refreshPanels} />
      ) : (
        <SelfPanel connection={connection} campaignId={campaignId} sheet={characterSheet} onUpdated={refreshPanels} />
      );
    }
    if (tab === "Folk") {
      return <FolkPanel connection={connection} campaignId={campaignId} npcRoster={npcRoster} />;
    }
    if (tab === "Quest") {
      return <QuestPanel questLog={questLog} />;
    }
    if (tab === "Views") {
      return characterSheet ? (
        <GalleryPanel
          connection={connection}
          campaignId={campaignId}
          characterSheet={characterSheet}
          npcRoster={npcRoster}
          worldState={worldState}
          generateVideos={generateVideos}
          onIllustrated={refreshPanels}
        />
      ) : (
        <PanelPending label="Views" />
      );
    }
    return <PanelPending label={tab} />;
  }

  // The scrolling story surface and the "what do you do?" input bar are the same
  // in both layouts; only their container differs (a vertical stack on mobile, a
  // centered left column beside the docked panel on desktop). Defined once here
  // so the two branches can't drift.
  const storyArea = (
    <div className="parchment" style={{ flex: 1, margin: "0 12px", minHeight: 0 }}>
      <div className="parchment-fill" />
      <div className="cx-scroll parchment-content" style={{ height: "100%", overflowY: "auto", padding: "22px 22px 16px" }}>
        {load.status === "loading" && (
          <p style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 15, textAlign: "center" }}>
            Reading the chronicle…
          </p>
        )}
        {load.status === "error" && (
          <p style={{ fontStyle: "italic", color: "var(--ember)", fontSize: 14, textAlign: "center" }}>
            Couldn't read this campaign: {load.message}
          </p>
        )}
        {load.status === "ready" && chapters.map((text, i) => <ChapterHeading key={i} text={text} />)}
        {/* ADR-0013: a zero-turn campaign is either having its opening scene
            woven now, or the opening failed and the player begins manually. */}
        {load.status === "ready" && turns.length === 0 && !openingError && (
          <OpeningSceneLoader connection={connection} campaignId={campaignId} />
        )}
        {load.status === "ready" && turns.length === 0 && openingError && (
          <p
            data-testid="opening-error"
            style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 15, textAlign: "center" }}
          >
            The scene wouldn't take shape just now — describe your first action to begin the tale.
          </p>
        )}
        {load.status === "ready" &&
          turns.map((turn, i) => (
            <TurnView
              key={i}
              turn={turn}
              connection={connection}
              campaignId={campaignId}
              onIllustrate={(description) => handleIllustrateMoment(i, description)}
              drawing={illustratingTurn === i}
              drawError={illustrateErrors[i] ?? null}
              imageNonce={imageNonces[i]}
              generateVideos={generateVideos}
              onAnimate={(description) => handleAnimateMoment(i, description)}
              animating={animatingTurn === i}
              animateError={animateErrors[i] ?? null}
              videoNonce={videoNonces[i]}
              onEdit={(newMessage) => handleEditTurn(i, newMessage)}
              canEdit={!sending && !openingScene && editingTurn === null && turn.narration !== null}
              editing={editingTurn === i}
              editError={editError?.index === i ? editError.message : null}
              discardCount={turns.length - 1 - i}
            />
          ))}
        {(sending || editingTurn !== null) && <WeavingIndicator />}
        <div ref={logEndRef} />
      </div>
    </div>
  );

  const inputBar = (
    <div style={{ flexShrink: 0, padding: "12px 14px 8px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: "linear-gradient(180deg,var(--leather-hi),var(--leather))",
          border: "1px solid var(--brass-dim)",
          borderRadius: 24,
          padding: "6px 6px 6px 16px",
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--arcane)" }} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={sending || openingScene || load.status !== "ready"}
          placeholder="What do you do?"
          data-testid="turn-input"
          style={{
            flex: 1,
            minWidth: 0,
            background: "none",
            border: "none",
            outline: "none",
            color: "var(--ink)",
            fontFamily: "var(--font-body)",
            fontStyle: "italic",
            fontSize: 15,
            padding: "6px 0",
          }}
        />
        <button
          onClick={handleSend}
          disabled={sending || openingScene || load.status !== "ready" || !input.trim()}
          data-testid="send-button"
          style={{
            width: 38,
            height: 38,
            flexShrink: 0,
            border: "none",
            borderRadius: "50%",
            background: "radial-gradient(circle at 38% 34%, #e08247, #a8511f 70%)",
            cursor: sending ? "default" : "pointer",
            opacity: sending ? 0.7 : 1,
          }}
        />
      </div>
    </div>
  );

  return (
    <div className="screen leather-ground">
      {/* ADR-0020: music is played by useMusicPlayer (its own Audio element +
          shuffled playlist from local files or a Navidrome playlist). The mute
          button only appears when the user has music enabled in Settings. */}
      <div style={{ flexShrink: 0, padding: isDesktop ? "20px 16px 10px" : "54px 16px 10px", display: "flex", alignItems: "center", gap: 10 }}>
        <button className="icon-button" onClick={onGoHome}>
          <span className="back-chevron" />
        </button>
        <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: 2, color: "var(--ink-dim)" }}>
            ACTIVE PLAY
          </div>
        </div>
        {/* Issue #108: playback transport (prev / play-pause / next) beside the
            mute button, only when music is enabled. Pause is independent of mute. */}
        {music.enabled && (
          <>
            <button
              className="icon-button"
              onClick={music.prev}
              aria-label="Previous track"
              data-testid="music-prev"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--brass)" aria-hidden="true">
                <rect x="3" y="3" width="2" height="10" rx="1" />
                <path d="M13 3.5v9L6 8z" />
              </svg>
            </button>
            <button
              className="icon-button"
              onClick={music.isPaused ? music.resume : music.pause}
              aria-pressed={music.isPaused}
              aria-label={music.isPaused ? "Play" : "Pause"}
              data-testid="music-playpause"
            >
              {music.isPaused ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--brass)" aria-hidden="true">
                  <path d="M4 3l9 5-9 5z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--brass)" aria-hidden="true">
                  <rect x="4" y="3" width="3" height="10" rx="1" />
                  <rect x="9" y="3" width="3" height="10" rx="1" />
                </svg>
              )}
            </button>
            <button
              className="icon-button"
              onClick={music.next}
              aria-label="Next track"
              data-testid="music-next"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--brass)" aria-hidden="true">
                <path d="M3 3.5v9L10 8z" />
                <rect x="11" y="3" width="2" height="10" rx="1" />
              </svg>
            </button>
          </>
        )}
        {music.enabled && (
          <button
            className="icon-button"
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? "Unmute" : "Mute"}
            data-testid="mute-toggle"
            style={{ gap: 2, position: "relative" }}
          >
            <div style={{ width: 2.5, height: 6, background: "var(--brass)", borderRadius: 1, opacity: muted ? 0.3 : 1, transition: "opacity 0.2s" }} />
            <div style={{ width: 2.5, height: 11, background: "var(--brass)", borderRadius: 1, opacity: muted ? 0.3 : 1, transition: "opacity 0.2s" }} />
            <div style={{ width: 2.5, height: 8, background: "var(--brass)", borderRadius: 1, opacity: muted ? 0.3 : 1, transition: "opacity 0.2s" }} />
            {muted && (
              <div
                data-testid="mute-slash"
                style={{ position: "absolute", width: 22, height: 1.5, background: "var(--ember)", transform: "rotate(-32deg)" }}
              />
            )}
          </button>
        )}
        {/* #109: per-game music override — always available (even when music is
            off), so a player can give this game its own music mid-session. A
            change reloads playback via useMusicPlayer.reload. */}
        <GameMusicPopover connection={connection} campaignId={campaignId} onChanged={music.reload} />
        {/* #114: this game's settings — Look/World/music and the (locked) engine. */}
        <button
          className="icon-button"
          onClick={onOpenSettings}
          aria-label="Game settings"
          data-testid="game-settings-open"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--brass)" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {isDesktop ? (
        // ADR-0021 desktop: story+input as a centered left column, panels docked
        // in a persistent right column (no bottom sheet).
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
            {storyArea}
            {inputBar}
          </div>
          <aside
            data-testid="desktop-sidebar"
            style={{
              width: activeTab === "Self" ? 560 : activeTab === "Views" ? 500 : 400,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              borderLeft: "1px solid rgba(109,90,56,.3)",
              background: "rgba(0,0,0,.16)",
            }}
          >
            <div style={{ flexShrink: 0, display: "flex", gap: 3, padding: "12px 12px 0" }}>
              {TABS.map((label) => {
                const selected = label === activeTab;
                return (
                  <button
                    key={label}
                    onClick={() => setOpenTab(label)}
                    data-testid={`tab-${label.toLowerCase()}`}
                    aria-pressed={selected}
                    style={{
                      flex: 1,
                      cursor: "pointer",
                      border: "none",
                      borderBottom: selected ? "2px solid var(--ember)" : "2px solid transparent",
                      background: selected ? "linear-gradient(180deg,var(--leather-hi),#120c07)" : "transparent",
                      borderRadius: "7px 7px 0 0",
                      padding: "10px 3px 9px",
                    }}
                  >
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 11, letterSpacing: 1, color: selected ? "var(--ink)" : "var(--ink-faint)" }}>
                      {label}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ flexShrink: 0, padding: "8px 16px 0", fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic" }}>
              {TAB_SUBTITLES[activeTab]}
            </div>
            <div className="cx-scroll" data-testid="desktop-panel" style={{ flex: 1, overflowY: "auto", padding: "14px 16px 26px", minHeight: 0 }}>
              {renderPanel(activeTab)}
            </div>
          </aside>
        </div>
      ) : (
        <>
          {storyArea}
          {inputBar}
          <div style={{ flexShrink: 0, display: "flex", gap: 3, padding: "0 10px 26px" }}>
            {TABS.map((label) => (
              <button
                key={label}
                onClick={() => setOpenTab(label)}
                data-testid={`tab-${label.toLowerCase()}`}
                style={{
                  flex: 1,
                  cursor: "pointer",
                  border: "none",
                  background: "linear-gradient(180deg,var(--leather-hi),#120c07)",
                  borderRadius: "9px 9px 0 0",
                  padding: "11px 3px 9px",
                }}
              >
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 11, letterSpacing: 1, color: "var(--ink-dim)" }}>
                  {label}
                </div>
              </button>
            ))}
          </div>

          {openTab && (
            <BottomSheet title={openTab.toUpperCase()} subtitle={TAB_SUBTITLES[openTab]} onClose={() => setOpenTab(null)}>
              {renderPanel(openTab)}
            </BottomSheet>
          )}
        </>
      )}
    </div>
  );
}
