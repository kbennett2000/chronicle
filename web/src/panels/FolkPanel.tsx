import type { Connection } from "../lib/connection";
import { parseNpcRoster } from "../lib/npc-roster";
import { EntityPortrait } from "../components/EntityPortrait";

interface FolkPanelProps {
  connection: Connection;
  campaignId: string;
  npcRoster: string;
}

export function FolkPanel({ connection, campaignId, npcRoster }: FolkPanelProps) {
  const npcs = parseNpcRoster(npcRoster);

  if (npcs.length === 0) {
    return (
      <p style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 15, textAlign: "center", marginTop: 40 }}>
        No one worth naming has crossed your path yet.
      </p>
    );
  }

  return (
    <div>
      {npcs.map((npc) => (
        <div
          key={npc.name}
          data-testid="folk-npc"
          style={{ display: "flex", gap: 13, padding: "12px 0", borderBottom: "1px solid rgba(109,90,56,.22)" }}
        >
          <EntityPortrait
            connection={connection}
            campaignId={campaignId}
            filename={npc.portraitImage}
            width={56}
            height={64}
            imageTestId="folk-portrait-image"
            emptyTestId="folk-portrait-none"
          />
          <div style={{ minWidth: 0 }}>
            <div data-testid="folk-npc-name" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15.5, color: "var(--ink)" }}>
              {npc.name}
            </div>
            {npc.disposition && (
              <div data-testid="folk-npc-disposition" style={{ fontFamily: "var(--font-display)", fontSize: 9.5, letterSpacing: 1, color: "var(--brass)", margin: "2px 0 5px" }}>
                {npc.disposition.toUpperCase()}
              </div>
            )}
            {npc.description && (
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--ink-dim)" }}>{npc.description}</div>
            )}
            {npc.knows && (
              <div style={{ fontSize: 12, lineHeight: 1.4, color: "var(--ink-faint)", fontStyle: "italic", marginTop: 5 }}>{npc.knows}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
