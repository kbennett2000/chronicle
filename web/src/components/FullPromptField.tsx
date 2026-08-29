import { useState } from "react";

// ADR-0038: "edit the full prompt" — a shared control that lets a user take over the
// ENTIRE assembled positive prompt (art-style clause + character look + scene), instead
// of just the visible caption. Used by both the gallery ImageEditor and the in-transcript
// moment regenerate box so the two surfaces never drift. The parent owns `enabled` and
// `value` (so its redraw() can read them); this component only handles the prefill fetch.

const labelStyle = { fontSize: 11.5, color: "var(--ink-dim)", margin: "10px 0 5px" } as const;
const fieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "rgba(12,8,5,.6)",
  border: "1px solid rgba(109,90,56,.5)",
  borderRadius: 6,
  padding: "7px 10px",
  color: "var(--ink)",
  fontFamily: "var(--font-body)",
  fontSize: 12.5,
  outline: "none",
};

export function FullPromptField({
  onRequestFullPrompt,
  description,
  enabled,
  onEnabledChange,
  value,
  onChange,
}: {
  /** Fetch the fully-assembled positive prompt for this image (a no-render preview). */
  onRequestFullPrompt: (description: string) => Promise<string | null>;
  /** The current caption, used as the basis for the previewed prompt. */
  description: string;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  value: string;
  onChange: (next: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const p = await onRequestFullPrompt(description);
      if (p != null) onChange(p);
    } catch {
      /* leave the box as-is; the user can still type a prompt from scratch */
    } finally {
      setLoading(false);
    }
  }

  function toggle(next: boolean) {
    onEnabledChange(next);
    // Prefill with the real assembled prompt the first time it's opened.
    if (next && !value && !loading) void load();
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid rgba(109,90,56,.3)", paddingTop: 10 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          data-testid="editor-advanced"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span style={{ fontSize: 12.5, color: "var(--ink)" }}>Advanced: edit the full prompt</span>
      </label>
      {enabled && (
        <div style={{ marginTop: 6 }}>
          <div style={labelStyle}>
            Full prompt{" "}
            <span style={{ color: "var(--ink-faint)" }}>
              — everything actually sent: art style, character look, then your scene
            </span>
          </div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            data-testid="editor-full-prompt"
            rows={5}
            placeholder={loading ? "loading the current prompt…" : "the full prompt…"}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <button
              type="button"
              data-testid="editor-full-prompt-reload"
              onClick={load}
              disabled={loading}
              style={{
                cursor: loading ? "default" : "pointer",
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid rgba(109,90,56,.5)",
                background: "transparent",
                color: "var(--ink-dim)",
                fontFamily: "var(--font-body)",
                fontSize: 11,
              }}
            >
              {loading ? "Loading…" : "↻ Reload current"}
            </button>
            <span style={{ fontSize: 10.5, color: "var(--ink-faint)", lineHeight: 1.3 }}>
              Replaces the auto-added character look — a character may look less consistent between images.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
