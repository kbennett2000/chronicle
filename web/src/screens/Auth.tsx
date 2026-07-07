import { useState } from "react";
import { login, register } from "../lib/auth";
import type { Connection } from "../lib/connection";

interface AuthProps {
  /** Pre-fill the server address from any prior connection (or the page origin). */
  initialServerAddress: string;
  onAuthenticated: (connection: Connection) => void;
}

const textInputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "rgba(12,8,5,.5)",
  border: "1px solid rgba(109,90,56,.4)",
  borderRadius: 4,
  padding: "11px 13px",
  color: "var(--ink)",
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  outline: "none",
};

const labelStyle = { fontSize: 11, color: "var(--ink-dim)", margin: "13px 0 4px" } as const;

/** ADR-0019: the first screen when no session token is stored. Points the app
 * at the home server and logs in or creates an account, then hands a full
 * Connection ({ serverAddress, token, username }) back up to App. */
export function Auth({ initialServerAddress, onAuthenticated }: AuthProps) {
  const defaultAddress =
    initialServerAddress || (typeof window !== "undefined" ? window.location.host : "");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [serverAddress, setServerAddress] = useState(defaultAddress);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = serverAddress.trim() && username.trim() && password && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const fn = mode === "login" ? login : register;
      const result = await fn(serverAddress.trim(), username.trim(), password);
      onAuthenticated({ serverAddress: serverAddress.trim(), token: result.token, username: result.username });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="screen leather-ground" style={{ height: "100%", overflowY: "auto" }}>
      <div style={{ maxWidth: 420, margin: "0 auto", padding: "48px 22px 32px" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 26,
            letterSpacing: 2,
            color: "var(--brass)",
            textAlign: "center",
          }}
        >
          CHRONICLE
        </div>
        <div
          style={{
            textAlign: "center",
            fontStyle: "italic",
            color: "var(--ink-faint)",
            fontSize: 12.5,
            margin: "6px 0 26px",
          }}
        >
          {mode === "login" ? "Return to your chronicles." : "Begin your own chronicles."}
        </div>

        <div style={labelStyle}>Server address</div>
        <input
          value={serverAddress}
          onChange={(e) => setServerAddress(e.target.value)}
          placeholder="192.168.1.24:4317"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={textInputStyle}
          data-testid="auth-server"
        />

        <div style={labelStyle}>Username</div>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={textInputStyle}
          data-testid="auth-username"
        />

        <div style={labelStyle}>Password</div>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={textInputStyle}
          data-testid="auth-password"
        />

        {error && (
          <div style={{ color: "var(--ember)", fontSize: 12, marginTop: 12 }} data-testid="auth-error">
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={!canSubmit}
          data-testid="auth-submit"
          style={{
            marginTop: 20,
            width: "100%",
            cursor: canSubmit ? "pointer" : "default",
            opacity: canSubmit ? 1 : 0.65,
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
          {busy ? "…" : mode === "login" ? "LOG IN" : "CREATE ACCOUNT"}
        </button>

        <button
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          data-testid="auth-toggle-mode"
          style={{
            marginTop: 14,
            width: "100%",
            cursor: "pointer",
            background: "none",
            border: "none",
            color: "var(--ink-dim)",
            fontFamily: "var(--font-body)",
            fontSize: 12.5,
            textDecoration: "underline",
          }}
        >
          {mode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
        </button>
      </div>
    </div>
  );
}
