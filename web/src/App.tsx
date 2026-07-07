import { useEffect, useRef, useState } from "react";
import { Home } from "./screens/Home";
import { Play } from "./screens/Play";
import { Settings } from "./screens/Settings";
import { NewCharacter } from "./screens/NewCharacter";
import { Auth } from "./screens/Auth";
import { checkConnection, type ConnectionStatus } from "./lib/api";
import { logout } from "./lib/auth";
import {
  hasConnection,
  loadConnection,
  saveConnection,
  clearConnection,
  type Connection,
} from "./lib/connection";
import { getCampaignId, listCampaigns } from "./lib/campaign";

type Screen = "home" | "play" | "settings" | "newcharacter" | "auth";

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
  // Now stateful (ADR-0010): seeded from ?campaign= (still wins when present,
  // keeping existing links + the e2e harness working) but switchable in-app by
  // picking a chronicle on Home or creating a new one. Issue #97: when no
  // ?campaign= is given it starts null (no longer the `test-campaign` fixture)
  // and is resolved to the user's own first campaign once connected.
  const [campaignId, setCampaignId] = useState<string | null>(getCampaignId());
  // True while we're still resolving which campaign to show, so Home renders a
  // loading state rather than flashing the "no chronicle yet" empty state for a
  // returning player. Starts true exactly when there's nothing to show yet.
  const [resolvingCampaign, setResolvingCampaign] = useState<boolean>(getCampaignId() === null);

  // Set by "Save & Reconnect" (issue #35): a deliberate reconnect from
  // Settings should, on success, drop the player back on Home rather than
  // silently leaving them staring at the Settings screen. The boot check and
  // the TEST button leave this false, so they don't navigate.
  const pendingReconnect = useRef(false);

  useEffect(() => {
    // ADR-0019: no token -> straight to the login/register screen.
    if (!hasConnection(connection)) {
      pendingReconnect.current = false;
      setScreen("auth");
      return;
    }
    setConnectionStatus("checking");
    checkConnection(connection).then((status) => {
      setConnectionStatus(status);
      // An expired/invalid token (401) sends the player back to Auth to log in
      // again; an unreachable server sends them to Settings to fix the address.
      // A successful *deliberate* reconnect returns them Home, ready to play.
      if (status === "unauthorized") {
        setScreen("auth");
      } else if (status !== "connected") {
        setScreen("settings");
      } else if (pendingReconnect.current) {
        setScreen("home");
      }
      pendingReconnect.current = false;
    });
  }, [connection]);

  // Issue #97: once connected, if no campaign is selected (no ?campaign=), adopt
  // the user's own first campaign from GET /campaigns. Zero campaigns leaves it
  // null, which Home renders as a first-run empty state — instead of the old
  // fixture fallback that 404'd for every real account.
  useEffect(() => {
    if (connectionStatus !== "connected") return;
    if (campaignId !== null) {
      setResolvingCampaign(false);
      return;
    }
    let cancelled = false;
    setResolvingCampaign(true);
    listCampaigns(connection)
      .then((all) => {
        if (cancelled) return;
        if (all.length > 0) setCampaignId(all[0].id);
        setResolvingCampaign(false);
      })
      .catch(() => {
        if (!cancelled) setResolvingCampaign(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, connectionStatus, campaignId]);

  function handleAuthenticated(next: Connection) {
    pendingReconnect.current = true;
    saveConnection(next);
    setConnection(next);
  }

  function handleSaveConnection(next: Connection) {
    pendingReconnect.current = true;
    saveConnection(next);
    setConnection(next);
  }

  function handleLogout() {
    void logout(connection);
    clearConnection();
    setConnection(loadConnection());
    setConnectionStatus("unchecked");
    setScreen("auth");
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
      {screen === "auth" && (
        <Auth initialServerAddress={connection.serverAddress} onAuthenticated={handleAuthenticated} />
      )}
      {screen === "home" && (
        <Home
          connection={connection}
          campaignId={campaignId}
          campaignResolving={resolvingCampaign}
          connectionStatus={connectionStatus}
          onContinue={() => setScreen("play")}
          onEnterCampaign={(id) => {
            setCampaignId(id);
            setScreen("play");
          }}
          onSwitchCampaign={(id) => setCampaignId(id)}
          onNewChronicle={() => setScreen("newcharacter")}
          onOpenSettings={() => setScreen("settings")}
        />
      )}
      {screen === "play" && campaignId && (
        <Play connection={connection} campaignId={campaignId} onGoHome={() => setScreen("home")} />
      )}
      {screen === "newcharacter" && (
        <NewCharacter
          connection={connection}
          onCreated={(id) => {
            setCampaignId(id);
            setScreen("play");
          }}
          onCancel={() => setScreen("home")}
        />
      )}
      {screen === "settings" && (
        <Settings
          onBack={() => setScreen(hasConnection(connection) ? "home" : "auth")}
          connection={connection}
          campaignId={campaignId}
          connectionStatus={connectionStatus}
          onSaveConnection={handleSaveConnection}
          onTestConnection={handleTestConnection}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
