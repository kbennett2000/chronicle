import { useEffect, useState } from "react";
import type { ConnectionStatus } from "../lib/api";
import type { Connection } from "../lib/connection";
import { getState, startSession, type StateSnapshot } from "../lib/campaign";
import { findMarkdownSection } from "../lib/markdown";
import { CURRENT_SITUATION_HEADING } from "../lib/state-headings";

interface HomeProps {
  connection: Connection;
  campaignId: string;
  connectionStatus: ConnectionStatus;
  onContinue: () => void;
  onOpenSettings: () => void;
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; snapshot: StateSnapshot };

export function Home({ connection, campaignId, connectionStatus, onContinue, onOpenSettings }: HomeProps) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    getState(connection, campaignId)
      .then((snapshot) => {
        if (!cancelled) setLoad({ status: "ready", snapshot });
      })
      .catch((err) => {
        if (!cancelled) setLoad({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [connection, campaignId]);

  async function handleContinue() {
    setStarting(true);
    setStartError(null);
    try {
      await startSession(connection, campaignId);
      onContinue();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  const situation =
    load.status === "ready" ? findMarkdownSection(load.snapshot.worldState, CURRENT_SITUATION_HEADING)?.body : undefined;

  return (
    <div className="screen leather-ground">
      <div className="cx-scroll" style={{ flex: 1, overflowY: "auto", padding: "66px 22px 30px" }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{ height: 1, width: 34, background: "linear-gradient(90deg,transparent,var(--brass-dim))" }} />
            <div style={{ width: 7, height: 7, background: "var(--brass-dim)", transform: "rotate(45deg)" }} />
            <div style={{ height: 1, width: 34, background: "linear-gradient(90deg,var(--brass-dim),transparent)" }} />
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 44,
              letterSpacing: 7,
              margin: "12px 0 2px",
              color: "var(--ink)",
              textShadow: "0 2px 18px rgba(211,112,60,.25)",
            }}
          >
            CHRONICLE
          </h1>
          <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 14, color: "var(--ink-faint)" }}>
            a solo tale, kept by candlelight
          </div>
        </div>

        <div
          style={{
            marginTop: 26,
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 12,
            letterSpacing: 2.5,
            color: "var(--brass-dim)",
            paddingLeft: 2,
          }}
        >
          YOUR CHRONICLES
        </div>

        <div className="parchment rise-in" data-testid="campaign-card" style={{ marginTop: 12 }}>
          <div className="parchment-fill" />
          <div className="parchment-content" style={{ padding: 20 }}>
            {load.status === "loading" && (
              <div style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 13.5, textAlign: "center" }}>
                Reading the chronicle…
              </div>
            )}
            {load.status === "error" && (
              <div style={{ fontStyle: "italic", color: "var(--ember)", fontSize: 13, textAlign: "center" }}>
                Couldn't read this campaign: {load.message}
              </div>
            )}
            {load.status === "ready" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      overflow: "hidden",
                      border: "1px solid var(--brass-dim)",
                      flexShrink: 0,
                      background: "rgba(20,12,6,.4)",
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div
                      data-testid="character-name"
                      style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15, letterSpacing: 0.6, color: "var(--ink)" }}
                    >
                      {load.snapshot.characterSheet.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                      {load.snapshot.characterSheet.race} {load.snapshot.characterSheet.class} · Level{" "}
                      {load.snapshot.characterSheet.level}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 11, paddingTop: 11, borderTop: "1px solid rgba(109,90,56,.32)" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--arcane)", opacity: 0.9 }}>
                    CURRENT SITUATION
                  </div>
                  <div
                    data-testid="current-situation"
                    style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-dim)", marginTop: 3, fontStyle: "italic" }}
                  >
                    {situation || "No situation recorded yet — the tale hasn't begun."}
                  </div>
                </div>
                <button
                  onClick={handleContinue}
                  disabled={starting}
                  data-testid="continue-button"
                  style={{
                    marginTop: 14,
                    width: "100%",
                    border: "none",
                    cursor: starting ? "default" : "pointer",
                    opacity: starting ? 0.7 : 1,
                    padding: 13,
                    borderRadius: 3,
                    background: "linear-gradient(180deg,#d8743e,#a8511f)",
                    boxShadow: "0 4px 14px rgba(160,70,25,.4), inset 0 1px 0 rgba(255,210,170,.4)",
                    color: "#faf0e2",
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontSize: 14,
                    letterSpacing: 2,
                  }}
                >
                  {starting ? "ENTERING…" : "CONTINUE THE TALE"}
                </button>
                {startError && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--ember)", textAlign: "center" }}>{startError}</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "12px 22px 30px",
          borderTop: "1px solid rgba(109,90,56,.28)",
          background: "linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.25))",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div
            data-testid="connection-dot"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: connectionStatus === "connected" ? "var(--arcane)" : "var(--ember)",
              boxShadow:
                connectionStatus === "connected" ? "0 0 8px var(--arcane)" : "0 0 8px var(--ember)",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
            the hearth · {connection.serverAddress || "not configured"}
          </span>
        </div>
        <button
          onClick={onOpenSettings}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--ink-dim)",
            fontFamily: "var(--font-display)",
            fontSize: 11.5,
            letterSpacing: 1.5,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              width: 15,
              height: 15,
              border: "1.5px solid var(--brass)",
              borderRadius: "50%",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ width: 5, height: 5, background: "var(--brass)", borderRadius: "50%" }} />
          </span>
          SETTINGS
        </button>
      </div>
    </div>
  );
}
