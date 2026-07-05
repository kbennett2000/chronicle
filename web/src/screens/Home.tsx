import type { ConnectionStatus } from "../lib/api";

interface HomeProps {
  onContinue: () => void;
  onOpenSettings: () => void;
  connectionStatus: ConnectionStatus;
  serverAddress: string;
}

export function Home({ onContinue, onOpenSettings, connectionStatus, serverAddress }: HomeProps) {
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

        {/* Campaign card wiring (GET /state, POST /session/start) lands in
            slice 2 — this stub only proves the shell can reach Play. */}
        <div className="parchment" style={{ marginTop: 12 }}>
          <div className="parchment-fill" />
          <div className="parchment-content" style={{ padding: 20, textAlign: "center" }}>
            <div style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 13.5 }}>
              Campaign card arrives in a later slice.
            </div>
            <button
              onClick={onContinue}
              style={{
                marginTop: 14,
                width: "100%",
                border: "none",
                cursor: "pointer",
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
              CONTINUE THE TALE
            </button>
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
            the hearth{serverAddress ? ` · ${serverAddress}` : " · not configured"}
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
