interface PlayProps {
  onGoHome: () => void;
}

const TABS = ["Self", "Folk", "Quest", "Views"];

/** Chrome only — narration hydration, POST /turns, and the journal panels
 * are slices 3-8. This proves the reading-surface layout, the input dock,
 * and the tab bar render, nothing is wired to the API yet. */
export function Play({ onGoHome }: PlayProps) {
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
        <div
          className="cx-scroll parchment-content"
          style={{ height: "100%", overflowY: "auto", padding: "22px 22px 16px", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <p style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 15, textAlign: "center" }}>
            The reading surface arrives in a later slice.
          </p>
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
            disabled
            placeholder="What do you do?"
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
            disabled
            style={{
              width: 38,
              height: 38,
              flexShrink: 0,
              border: "none",
              borderRadius: "50%",
              background: "radial-gradient(circle at 38% 34%, #e08247, #a8511f 70%)",
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
