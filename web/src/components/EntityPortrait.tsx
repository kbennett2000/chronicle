import type { Connection } from "../lib/connection";
import { useAuthedImage } from "../lib/useAuthedImage";

interface EntityPortraitProps {
  connection: Connection;
  campaignId: string;
  filename: string | undefined;
  width: number;
  height: number;
  imageTestId?: string;
  emptyTestId?: string;
}

/** Shared "portrait, or a normal-looking no-likeness tile" chrome —
 * introduced in Slice 20 for the Self panel's character portrait, reused
 * as-is (just parameterized on size) for Folk's NPC rows in Slice 21, so
 * neither drifts stylistically from the other over time. */
export function EntityPortrait({ connection, campaignId, filename, width, height, imageTestId, emptyTestId }: EntityPortraitProps) {
  const { url } = useAuthedImage(connection, campaignId, filename);
  const boxStyle = { width, height, flexShrink: 0, borderRadius: 2, overflow: "hidden" as const };

  if (filename && url) {
    return (
      <div style={{ ...boxStyle, boxShadow: "0 4px 12px rgba(0,0,0,.5), 0 0 0 1px rgba(184,150,90,.5), inset 0 0 0 3px rgba(20,12,6,.4)" }}>
        <img src={url} alt="" data-testid={imageTestId} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }

  return (
    <div
      data-testid={emptyTestId}
      style={{
        ...boxStyle,
        background: "rgba(20,12,6,.4)",
        border: "1px dashed rgba(109,90,56,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 10, lineHeight: 1.3, color: "var(--ink-faint)", padding: "0 4px" }}>
        no likeness yet
      </span>
    </div>
  );
}
