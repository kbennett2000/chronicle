import type { ReactNode } from "react";

interface BottomSheetProps {
  title: string;
  /** One-line explanation of what this panel is for — issues #38–#41 were
   * "what is this screen / why does it exist," so every drawer now says so
   * under its title. */
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

/** Generic journal-panel chrome (grabber, title, ✕, scrim) per the
 * handoff's bottom-sheet spec — panel content is supplied by the caller.
 * Tapping the scrim, the grabber, or the ✕ all close it. */
export function BottomSheet({ title, subtitle, onClose, children }: BottomSheetProps) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div className="sheet-scrim" data-testid="sheet-scrim" onClick={onClose} />
      <div className="sheet-panel">
        <div className="sheet-fill" />
        <div style={{ position: "relative", flexShrink: 0, padding: "12px 20px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={onClose}
            data-testid="sheet-grabber"
            aria-label="Close panel"
            style={{
              position: "absolute",
              top: 8,
              left: "50%",
              transform: "translateX(-50%)",
              width: 38,
              height: 4,
              padding: 0,
              border: "none",
              borderRadius: 2,
              background: "var(--brass-dim)",
              cursor: "pointer",
            }}
          />
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: 1.5, color: "var(--ink)", marginTop: 6 }}>
            {title}
          </div>
          <button
            onClick={onClose}
            data-testid="sheet-close"
            aria-label="Close panel"
            style={{
              marginTop: 6,
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "rgba(20,12,6,.4)",
              border: "1px solid var(--brass-dim)",
              cursor: "pointer",
              color: "var(--ink-dim)",
              fontSize: 15,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>
        {subtitle && (
          <div
            data-testid="sheet-subtitle"
            style={{
              position: "relative",
              flexShrink: 0,
              padding: "0 20px 6px",
              fontFamily: "var(--font-body)",
              fontStyle: "italic",
              fontSize: 12.5,
              lineHeight: 1.4,
              color: "var(--ink-faint)",
            }}
          >
            {subtitle}
          </div>
        )}
        <div className="cx-scroll" style={{ position: "relative", flex: 1, overflowY: "auto", padding: "8px 20px 30px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
