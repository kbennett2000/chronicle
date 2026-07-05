import { useState } from "react";
import type { Connection } from "../lib/connection";
import type { ConnectionStatus } from "../lib/api";

interface SettingsProps {
  onBack: () => void;
  connection: Connection;
  connectionStatus: ConnectionStatus;
  onSaveConnection: (connection: Connection) => void;
  onTestConnection: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  unchecked: "Not yet tested",
  checking: "Testing…",
  connected: "Connected to the hearth",
  unauthorized: "Wrong passphrase",
  unreachable: "Could not reach that address",
};

/** Only "The Hearth" (connection) is wired this slice — Engine/Look/World
 * are slice 9. This is the piece the 401 -> Settings redirect flow and
 * every other screen's auth loop actually depends on. */
export function Settings({
  onBack,
  connection,
  connectionStatus,
  onSaveConnection,
  onTestConnection,
}: SettingsProps) {
  const [serverAddress, setServerAddress] = useState(connection.serverAddress);
  const [passphrase, setPassphrase] = useState(connection.passphrase);

  const dotColor = connectionStatus === "connected" ? "var(--arcane)" : "var(--ember)";

  return (
    <div className="screen leather-ground">
      <div
        style={{
          flexShrink: 0,
          padding: "54px 16px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid rgba(109,90,56,.3)",
        }}
      >
        <button className="icon-button" onClick={onBack}>
          <span className="back-chevron" />
        </button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: 2, color: "var(--ink)" }}>
          SETTINGS
        </div>
      </div>

      <div className="cx-scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 18px 40px" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)", margin: "2px 0 4px" }}>
          THE ENGINE
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic" }}>
          Model selection arrives in a later slice.
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)", margin: "22px 0 4px" }}>
          THE LOOK / THE WORLD
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-faint)", fontStyle: "italic" }}>
          Art style, world setting, tone, and content intensity arrive in a
          later slice.
        </div>

        <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)", margin: "22px 0 4px" }}>
          THE HEARTH
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic", marginBottom: 10 }}>
          Your phone only talks to your home server over the LAN — that
          server is what reaches out to Claude and Grok.
        </div>

        <div style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 4 }}>Server address</div>
        <input
          value={serverAddress}
          onChange={(e) => setServerAddress(e.target.value)}
          placeholder="192.168.1.24:4317"
          style={{
            width: "100%",
            background: "rgba(12,8,5,.5)",
            border: "1px solid rgba(109,90,56,.4)",
            borderRadius: 4,
            padding: "10px 13px",
            color: "var(--ink)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <div style={{ fontSize: 11, color: "var(--ink-dim)", margin: "11px 0 4px" }}>Passphrase</div>
        <input
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          type="password"
          style={{
            width: "100%",
            background: "rgba(12,8,5,.5)",
            border: "1px solid rgba(109,90,56,.4)",
            borderRadius: 4,
            padding: "10px 13px",
            color: "var(--ink)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            outline: "none",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
            <span style={{ fontSize: 11.5, color: "var(--ink-dim)" }}>{STATUS_LABEL[connectionStatus]}</span>
          </div>
          <button
            onClick={onTestConnection}
            style={{
              cursor: "pointer",
              padding: "8px 14px",
              borderRadius: 3,
              background: "rgba(36,26,16,.6)",
              border: "1px solid var(--brass-dim)",
              color: "var(--ink-dim)",
              fontFamily: "var(--font-display)",
              fontSize: 11,
              letterSpacing: 1.5,
            }}
          >
            TEST
          </button>
        </div>

        <button
          onClick={() => onSaveConnection({ serverAddress, passphrase })}
          style={{
            marginTop: 18,
            width: "100%",
            cursor: "pointer",
            padding: 12,
            borderRadius: 3,
            background: "linear-gradient(180deg,#d8743e,#a8511f)",
            border: "none",
            color: "#faf0e2",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 1.5,
          }}
        >
          SAVE & RECONNECT
        </button>
      </div>
    </div>
  );
}
