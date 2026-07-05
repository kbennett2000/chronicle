import { useEffect, useRef, useState } from "react";
import type { Connection } from "../lib/connection";
import { getState, sendTurn } from "../lib/campaign";
import { parseSessionLog, type LogEntry } from "../lib/session-log";

interface PlayProps {
  connection: Connection;
  campaignId: string;
  onGoHome: () => void;
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

const TABS = ["Self", "Folk", "Quest", "Views"];

function LogEntryView({ entry }: { entry: LogEntry }) {
  if (entry.type === "chapter") {
    return (
      <div style={{ textAlign: "center", margin: "2px 0 20px" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2.5, color: "var(--brass-dim)" }}>
          {entry.text}
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
  if (entry.type === "player") {
    return (
      <div style={{ margin: "0 0 16px", paddingLeft: 12, borderLeft: "2px solid var(--ember-deep)" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 2, color: "var(--ember)", marginBottom: 2 }}>
          YOU
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.55, fontStyle: "italic", color: "var(--ink-dim)" }}>{entry.text}</div>
      </div>
    );
  }
  return (
    <p
      style={{
        margin: "0 0 16px",
        fontSize: 16,
        lineHeight: 1.64,
        color: entry.isError ? "var(--ember)" : "var(--ink)",
        whiteSpace: "pre-wrap",
      }}
    >
      {entry.text}
    </p>
  );
}

/** Chapter/narration entries hydrate from currentSessionLog?.content (a
 * flat per-turn bullet list — see lib/session-log.ts for why history
 * can't be split into player/DM/story-event sub-types the way a turn
 * happening live in this session can). Image reveals and the HP wax-note
 * are out of scope this slice. */
export function Play({ connection, campaignId, onGoHome }: PlayProps) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getState(connection, campaignId)
      .then((snapshot) => {
        if (cancelled) return;
        // A brand-new campaign has no currentSessionLog at all yet — a
        // real empty state (no turns taken), not an error.
        setEntries(snapshot.currentSessionLog ? parseSessionLog(snapshot.currentSessionLog.content) : []);
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
  }, [entries, sending]);

  async function handleSend() {
    const message = input.trim();
    if (!message || sending) return;
    setEntries((prev) => [...prev, { type: "player", text: message }]);
    setInput("");
    setSending(true);
    try {
      const result = await sendTurn(connection, campaignId, message);
      setEntries((prev) => [...prev, { type: "narration", text: result.narration, isError: result.isError }]);
    } catch (err) {
      setEntries((prev) => [
        ...prev,
        { type: "narration", text: err instanceof Error ? err.message : String(err), isError: true },
      ]);
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
          {/* session/start creates the session-log file (and its chapter
              heading) up front, before any turn happens — so a truly
              untouched session still has one chapter entry with no
              narration/player content under it. That's the real empty
              state to check for, not "zero entries". */}
          {load.status === "ready" && !entries.some((e) => e.type !== "chapter") && !sending && (
            <p style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 15, textAlign: "center" }}>
              The tale hasn't begun — say what you do.
            </p>
          )}
          {load.status === "ready" &&
            entries.map((entry, i) => <LogEntryView key={i} entry={entry} />)}
          {sending && (
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
          )}
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
            disabled
            style={{
              flex: 1,
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
    </div>
  );
}
