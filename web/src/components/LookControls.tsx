import { useEffect, useState, type CSSProperties } from "react";

// Shared "look & play" controls used by both the Settings screen and the New
// Chronicle create screen (issue #64 surfaced these dials at creation). Kept as
// small presentational pieces — the caller owns persistence: Settings applies
// each change immediately (POST /settings), New Chronicle collects them into the
// create payload.

/** Art-style presets offered as chips. Single source of truth for both screens. */
export const ART_PRESETS = [
  "comic book",
  "Lego-style",
  "pencil sketch",
  "watercolour",
  "anime",
  "pixel art",
  "noir",
  "oil painting",
];

interface ToggleRowProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId: string;
  /** Extra styling on the row container (e.g. top margin when stacked). */
  containerStyle?: CSSProperties;
}

/** A labeled pill toggle row — the scene-art / auto-illustrate / auto-roll switch. */
export function ToggleRow({ title, description, checked, onChange, testId, containerStyle }: ToggleRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "11px 14px",
        borderRadius: 4,
        background: "rgba(28,20,12,.55)",
        border: "1px solid rgba(109,90,56,.36)",
        ...containerStyle,
      }}
    >
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 13.5, color: "var(--ink)" }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 2 }}>{description}</div>
      </div>
      <button
        data-testid={testId}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        style={{
          width: 46,
          height: 26,
          borderRadius: 20,
          cursor: "pointer",
          border: `1px solid ${checked ? "rgba(211,112,60,.9)" : "rgba(109,90,56,.4)"}`,
          background: checked ? "rgba(211,112,60,.85)" : "rgba(12,8,5,.6)",
          position: "relative",
          transition: "background 0.2s, border-color 0.2s",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 24 : 2,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: checked ? "#fbeede" : "#8c7c62",
            transition: "left 0.2s, background 0.2s",
          }}
        />
      </button>
    </div>
  );
}

interface ImageProviderPickerProps {
  /** The effective image engine — falls back to "grok" (the code default) when
   * this account/game hasn't set one. */
  value: "grok" | "local";
  onChange: (provider: "grok" | "local") => void;
}

/** ADR-0027: pick which engine draws images — the cloud Grok CLI or a self-hosted
 * ComfyUI on your own GPU. Two-button toggle styled like the DM EnginePicker's
 * provider row. Freely switchable (no session reset), so no read-only mode. */
export function ImageProviderPicker({ value, onChange }: ImageProviderPickerProps) {
  const options: { id: "grok" | "local"; label: string; hint: string }[] = [
    { id: "grok", label: "Grok Build", hint: "cloud · the grok CLI" },
    { id: "local", label: "Local · ComfyUI", hint: "your GPU · SDXL, no cost" },
  ];
  return (
    <>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "12px 0 7px" }}>
        Image engine <span style={{ color: "var(--ink-faint)" }}>— who draws the pictures</span>
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              data-testid="image-provider-option"
              data-provider={o.id}
              data-selected={active}
              onClick={() => onChange(o.id)}
              style={{
                flex: 1,
                cursor: "pointer",
                padding: "9px 12px",
                borderRadius: 4,
                textAlign: "left",
                color: active ? "var(--ink)" : "var(--ink-faint)",
                background: active ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                border: `1px solid ${active ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
              }}
            >
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13 }}>{o.label}</div>
              <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>{o.hint}</div>
            </button>
          );
        })}
      </div>
    </>
  );
}

interface ImageQualityPickerProps {
  /** The effective quality tier — falls back to "standard" (the code default) when
   * this account/game hasn't set one. */
  value: "fast" | "standard" | "high";
  onChange: (quality: "fast" | "standard" | "high") => void;
}

/** ADR-0029: pick the LOCAL engine's quality tier — time-for-quality at a fixed
 * resolution. "standard" is today's output; "high" adds an SDXL refiner pass. Same
 * three-button toggle styling as the engine picker. Only meaningful for the local
 * engine (grok ignores it), but shown whenever scene art is on — harmless if grok. */
export function ImageQualityPicker({ value, onChange }: ImageQualityPickerProps) {
  const options: { id: "fast" | "standard" | "high"; label: string; hint: string }[] = [
    { id: "fast", label: "Fast", hint: "quicker · fewer steps" },
    { id: "standard", label: "Standard", hint: "the usual balance" },
    { id: "high", label: "High", hint: "slower · refiner pass" },
  ];
  return (
    <>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "12px 0 7px" }}>
        Image quality <span style={{ color: "var(--ink-faint)" }}>— local engine · trades time for detail</span>
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              data-testid="image-quality-option"
              data-quality={o.id}
              data-selected={active}
              onClick={() => onChange(o.id)}
              style={{
                flex: 1,
                cursor: "pointer",
                padding: "9px 12px",
                borderRadius: 4,
                textAlign: "left",
                color: active ? "var(--ink)" : "var(--ink-faint)",
                background: active ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                border: `1px solid ${active ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
              }}
            >
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13 }}>{o.label}</div>
              <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>{o.hint}</div>
            </button>
          );
        })}
      </div>
    </>
  );
}

interface ArtStylePickerProps {
  /** The effective art style (a preset name, a custom string, or ""). */
  artStyle: string;
  /** Called with the chosen style — a preset name on chip click, or the trimmed
   * custom text on blur. Callers persist/store from here. */
  onChange: (style: string) => void;
}

/** Preset chips plus a free-text custom field. Owns the local "typing a custom
 * style" buffer so the parent only tracks the committed value. */
export function ArtStylePicker({ artStyle, onChange }: ArtStylePickerProps) {
  const [customArtStyle, setCustomArtStyle] = useState(
    artStyle && !ART_PRESETS.includes(artStyle) ? artStyle : ""
  );

  // Keep the custom buffer in step when the committed style changes from outside
  // (e.g. Settings finishes loading, or a preset chip is chosen).
  useEffect(() => {
    if (artStyle && !ART_PRESETS.includes(artStyle)) setCustomArtStyle(artStyle);
    else if (ART_PRESETS.includes(artStyle)) setCustomArtStyle("");
  }, [artStyle]);

  return (
    <>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "12px 0 7px" }}>
        Art style <span style={{ color: "var(--ink-faint)" }}>— appended to every image prompt</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ART_PRESETS.map((preset) => {
          const selected = artStyle === preset && !customArtStyle;
          return (
            <button
              key={preset}
              data-testid="art-preset"
              data-selected={selected}
              onClick={() => {
                setCustomArtStyle("");
                onChange(preset);
              }}
              style={{
                cursor: "pointer",
                padding: "7px 12px",
                borderRadius: 20,
                fontFamily: "var(--font-body)",
                fontSize: 12.5,
                background: selected ? "rgba(211,112,60,.9)" : "rgba(28,20,12,.5)",
                border: `1px solid ${selected ? "rgba(211,112,60,.9)" : "rgba(109,90,56,.36)"}`,
                color: selected ? "#fbeede" : "var(--ink-dim)",
              }}
            >
              {preset}
            </button>
          );
        })}
      </div>
      <input
        value={customArtStyle}
        onChange={(e) => setCustomArtStyle(e.target.value)}
        onBlur={() => {
          if (customArtStyle.trim()) onChange(customArtStyle.trim());
        }}
        placeholder="or describe your own — stained glass, ukiyo-e, storybook…"
        data-testid="art-custom-input"
        style={{
          marginTop: 8,
          width: "100%",
          boxSizing: "border-box",
          background: customArtStyle ? "rgba(124,61,32,.2)" : "rgba(12,8,5,.5)",
          border: `1px solid ${customArtStyle ? "rgba(211,112,60,.7)" : "rgba(109,90,56,.4)"}`,
          borderRadius: 20,
          padding: "8px 14px",
          color: "var(--ink)",
          fontFamily: "var(--font-body)",
          fontStyle: "italic",
          fontSize: 13,
          outline: "none",
        }}
      />
    </>
  );
}
