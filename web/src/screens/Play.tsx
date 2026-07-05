import { useEffect, useRef, useState } from "react";
import type { Connection } from "../lib/connection";
import { getState, sendTurn, type CharacterSheet } from "../lib/campaign";
import { parseChapterHeadings } from "../lib/session-log";
import { BottomSheet } from "../components/BottomSheet";
import { SelfPanel } from "../panels/SelfPanel";
import { FolkPanel } from "../panels/FolkPanel";
import { QuestPanel } from "../panels/QuestPanel";
import { GalleryPanel } from "../panels/GalleryPanel";

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
}

const TABS = ["Self", "Folk", "Quest", "Views"] as const;
type Tab = (typeof TABS)[number];

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

function TurnView({ turn }: { turn: DisplayTurn }) {
  return (
    <>
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
    </>
  );
}

function WeavingIndicator() {
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
        The Dungeon Master is weaving what happens next
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
  const [openTab, setOpenTab] = useState<Tab | null>(null);
  const [characterSheet, setCharacterSheet] = useState<CharacterSheet | null>(null);
  const [npcRoster, setNpcRoster] = useState<string>("");
  const [questLog, setQuestLog] = useState<string>("");
  const [worldState, setWorldState] = useState<string>("");
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getState(connection, campaignId)
      .then((snapshot) => {
        if (cancelled) return;
        setCharacterSheet(snapshot.characterSheet);
        setNpcRoster(snapshot.npcRoster);
        setQuestLog(snapshot.questLog);
        setWorldState(snapshot.worldState);
        // A brand-new campaign has no currentSessionLog at all yet — a
        // real empty state (no turns taken), not an error.
        if (snapshot.currentSessionLog) {
          setChapters(parseChapterHeadings(snapshot.currentSessionLog.content));
          setTurns(
            snapshot.currentSessionLog.transcript.map((record) => ({
              playerMessage: record.playerMessage,
              narration: record.narration,
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

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [turns, sending]);

  async function handleSend() {
    const message = input.trim();
    if (!message || sending) return;
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

  return (
    <div className="screen leather-ground">
      <div style={{ flexShrink: 0, padding: "54px 16px 10px", display: "flex", alignItems: "center", gap: 10 }}>
        <button className="icon-button" onClick={onGoHome}>
          <span className="back-chevron" />
        </button>
        <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: 2, color: "var(--ink-dim)" }}>
            ACTIVE PLAY
          </div>
        </div>
        <button className="icon-button" disabled>
          <div style={{ width: 2.5, height: 6, background: "var(--brass)", borderRadius: 1 }} />
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
          {load.status === "ready" && turns.length === 0 && !sending && (
            <p style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 15, textAlign: "center" }}>
              The tale hasn't begun — say what you do.
            </p>
          )}
          {load.status === "ready" && turns.map((turn, i) => <TurnView key={i} turn={turn} />)}
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
            disabled={sending || load.status !== "ready"}
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
            disabled={sending || load.status !== "ready" || !input.trim()}
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
        <BottomSheet title={openTab.toUpperCase()} onClose={() => setOpenTab(null)}>
          {openTab === "Self" && characterSheet ? (
            <SelfPanel connection={connection} campaignId={campaignId} sheet={characterSheet} />
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
