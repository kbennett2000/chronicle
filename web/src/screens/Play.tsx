import { useEffect, useRef, useState } from "react";
import type { Connection } from "../lib/connection";
import {
  getState,
  sendTurn,
  generateOpening,
  illustrateMoment,
  getCampaignSettings,
  type CharacterSheet,
  type StateSnapshot,
} from "../lib/campaign";
import { useAuthedImage } from "../lib/useAuthedImage";
import { parseChapterHeadings } from "../lib/session-log";
import { BottomSheet } from "../components/BottomSheet";
import { SelfPanel } from "../panels/SelfPanel";
import { FolkPanel } from "../panels/FolkPanel";
import { QuestPanel } from "../panels/QuestPanel";
import { GalleryPanel } from "../panels/GalleryPanel";
import { loadMuted, saveMuted } from "../lib/mute";

interface PlayProps {
  connection: Connection;
  campaignId: string;
  onGoHome: () => void;
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
function MomentImage({ connection, campaignId, filename }: { connection: Connection; campaignId: string; filename: string }) {
  const { url } = useAuthedImage(connection, campaignId, filename);
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

function TurnView({
  turn,
  connection,
  campaignId,
  onIllustrate,
  drawing,
  drawError,
}: {
  turn: DisplayTurn;
  connection: Connection;
  campaignId: string;
  onIllustrate: () => void;
  drawing: boolean;
  drawError: string | null;
}) {
  // A moment can be illustrated once it has real (non-error) narration and
  // has been persisted server-side (i.e. it's a settled turn, not the one
  // still weaving). Already-illustrated moments show the image instead.
  const canIllustrate = turn.narration !== null && !turn.isError;
  return (
    <>
      {/* ADR-0013: a turn-zero opening scene has an empty playerMessage (the DM
          spoke unprompted) — render narration alone, with no "YOU" block. */}
      {turn.playerMessage.trim() !== "" && (
        <div style={{ margin: "0 0 16px", paddingLeft: 12, borderLeft: "2px solid var(--ember-deep)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 2, color: "var(--ember)", marginBottom: 2 }}>
            YOU
          </div>
          <div
            data-testid="player-message"
            style={{ fontSize: 15, lineHeight: 1.55, fontStyle: "italic", color: "var(--ink-dim)" }}
          >
            {turn.playerMessage}
          </div>
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
      {turn.image && <MomentImage connection={connection} campaignId={campaignId} filename={turn.image} />}
      {canIllustrate && !turn.image && (
        <div style={{ margin: "-6px 0 18px" }}>
          <button
            data-testid="illustrate-moment"
            onClick={onIllustrate}
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
    </>
  );
}

/** Issue #59: a brand-new game's opening scene is a full DM turn that can take
 * many seconds. The old tiny top-left "setting the scene…" line on an otherwise
 * empty parchment left players unsure anything was happening. This is a
 * prominent, centered, reassuring state used only for the turn-zero opening. */
function OpeningSceneLoader() {
  return (
    <div
      data-testid="opening-loader"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        minHeight: "60vh",
        gap: 18,
        padding: "0 24px",
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
export function Play({ connection, campaignId, onGoHome }: PlayProps) {
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
  const audioRef = useRef<HTMLAudioElement>(null);

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
        setTurns([{ playerMessage: "", narration: result.narration }]);
        // Current Situation / gear the opening just established need to reach
        // the Self/Views panels, same as after a normal turn.
        getState(connection, campaignId).then(applyPanelState).catch(() => {});
        // Issue #56: auto-illustrate the opening scene (turn 0) too, if on.
        if (autoIllustrateRef.current) {
          void handleIllustrateMoment(0);
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

  // Issue #43: the mute button now controls a real ambient bed. Browsers block
  // autoplay until a user gesture, so we try immediately (entering Play was
  // itself a tap, which often counts) and, if that's rejected, arm a one-shot
  // listener to start on the first interaction. Muting pauses; unmuting (always
  // a click, so never blocked) resumes.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = 0.32;
    let armed = false;
    const start = () => {
      if (muted || !audioRef.current) return;
      audioRef.current.play().catch(() => {});
    };
    const onGesture = () => {
      start();
      disarm();
    };
    const disarm = () => {
      if (!armed) return;
      armed = false;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    if (!muted) {
      el.play().catch(() => {
        armed = true;
        window.addEventListener("pointerdown", onGesture);
        window.addEventListener("keydown", onGesture);
      });
    }
    return disarm;
    // Mount once; mute changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (muted) el.pause();
    else el.play().catch(() => {});
  }, [muted]);

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
        next[next.length - 1] = { playerMessage: message, narration: result.narration, isError: result.isError };
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
        if (autoIllustrateRef.current) {
          void handleIllustrateMoment(newTurnIndex);
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
  async function handleIllustrateMoment(index: number) {
    if (illustratingTurn !== null) return;
    setIllustratingTurn(index);
    setIllustrateErrors((prev) => {
      const { [index]: _removed, ...rest } = prev;
      return rest;
    });
    try {
      const result = await illustrateMoment(connection, campaignId, index);
      if (result.ok && result.relPath) {
        const relPath = result.relPath;
        setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, image: relPath } : t)));
      } else {
        setIllustrateErrors((prev) => ({ ...prev, [index]: result.error || "Grok Build couldn't draw this." }));
      }
    } catch (err) {
      setIllustrateErrors((prev) => ({ ...prev, [index]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIllustratingTurn(null);
    }
  }

  // Re-fetch state after a gallery illustration so the newly-recorded portrait
  // reaches the panels that read it.
  function refreshPanels() {
    getState(connection, campaignId).then(applyPanelState).catch(() => {});
  }

  return (
    <div className="screen leather-ground">
      {/* Issue #43: the ambient bed the mute button controls. Loops seamlessly
          (see web/public/audio/README.md); .ogg primary, .mp3 fallback. */}
      {/* Issue #53: `?v=` cache-busts the fixed filename. The URL never changes
          on its own, and the server sends no content-hash, so without this bump
          a browser keeps playing the previously-cached bed after a re-record.
          Bump the number whenever ambient.ogg/.mp3 are regenerated. */}
      <audio ref={audioRef} loop preload="auto" data-testid="ambient-audio">
        <source src="/audio/ambient.ogg?v=3" type="audio/ogg" />
        <source src="/audio/ambient.mp3?v=3" type="audio/mpeg" />
      </audio>
      <div style={{ flexShrink: 0, padding: "54px 16px 10px", display: "flex", alignItems: "center", gap: 10 }}>
        <button className="icon-button" onClick={onGoHome}>
          <span className="back-chevron" />
        </button>
        <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: 2, color: "var(--ink-dim)" }}>
            ACTIVE PLAY
          </div>
        </div>
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
      </div>

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
          {load.status === "ready" && turns.length === 0 && !openingError && <OpeningSceneLoader />}
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
                onIllustrate={() => handleIllustrateMoment(i)}
                drawing={illustratingTurn === i}
                drawError={illustrateErrors[i] ?? null}
              />
            ))}
          {sending && <WeavingIndicator />}
          <div ref={logEndRef} />
        </div>
      </div>

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
          {openTab === "Self" && characterSheet ? (
            <SelfPanel connection={connection} campaignId={campaignId} sheet={characterSheet} onUpdated={refreshPanels} />
          ) : openTab === "Folk" ? (
            <FolkPanel connection={connection} campaignId={campaignId} npcRoster={npcRoster} />
          ) : openTab === "Quest" ? (
            <QuestPanel questLog={questLog} />
          ) : openTab === "Views" && characterSheet ? (
            <GalleryPanel
              connection={connection}
              campaignId={campaignId}
              characterSheet={characterSheet}
              npcRoster={npcRoster}
              worldState={worldState}
              onIllustrated={refreshPanels}
            />
          ) : (
            <p style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 15, textAlign: "center", marginTop: 40 }}>
              {openTab} panel — coming soon
            </p>
          )}
        </BottomSheet>
      )}
    </div>
  );
}
