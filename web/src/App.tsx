import { useEffect, useState } from "react";
import { Home } from "./screens/Home";
import { Play } from "./screens/Play";
import { Settings } from "./screens/Settings";
import { checkConnection, type ConnectionStatus } from "./lib/api";
import { hasConnection, loadConnection, saveConnection, type Connection } from "./lib/connection";
import { getCampaignId } from "./lib/campaign";

type Screen = "home" | "play" | "settings";

/** The one-off SVG filter every parchment surface references via
 * filter:url(#deckle) — ported verbatim from the handoff. */
function DeckleFilters() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <filter id="deckle" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.013 0.017" numOctaves={2} seed={7} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={12} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="deckle2" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.03" numOctaves={2} seed={21} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={7} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [connection, setConnection] = useState<Connection>(() => loadConnection());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("unchecked");
  const campaignId = getCampaignId();

  useEffect(() => {
    if (!hasConnection(connection)) {
      setScreen("settings");
      return;
    }
    setConnectionStatus("checking");
    checkConnection(connection).then((status) => {
      setConnectionStatus(status);
      // The 401/unreachable -> Settings redirect: nothing else in the app
      // works without a valid connection, so send the player straight to
      // where they can fix it.
      if (status !== "connected") setScreen("settings");
    });
  }, [connection]);

  function handleSaveConnection(next: Connection) {
    saveConnection(next);
    setConnection(next);
  }

  function handleTestConnection() {
    setConnectionStatus("checking");
    checkConnection(connection).then(setConnectionStatus);
  }

  return (
    <div
      style={{
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: "var(--void)",
        color: "var(--ink)",
      }}
    >
      <DeckleFilters />
      <div className="candlelight" />
      {screen === "home" && (
        <Home
          connection={connection}
          campaignId={campaignId}
          connectionStatus={connectionStatus}
          onContinue={() => setScreen("play")}
          onOpenSettings={() => setScreen("settings")}
        />
      )}
      {screen === "play" && (
        <Play connection={connection} campaignId={campaignId} onGoHome={() => setScreen("home")} />
      )}
      {screen === "settings" && (
        <Settings
          onBack={() => setScreen(hasConnection(connection) ? "home" : "settings")}
          connection={connection}
          connectionStatus={connectionStatus}
          onSaveConnection={handleSaveConnection}
          onTestConnection={handleTestConnection}
        />
      )}
    </div>
  );
}
