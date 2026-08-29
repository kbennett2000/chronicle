import { useState } from "react";
import type { ImageOverrides } from "../lib/campaign";
import { ART_PRESETS, PRESET_LABELS } from "./LookControls";

// #157 (Slice C): Scriptorium's "Edit picture", scoped to Chronicle. Opens over one
// already-generated image and redraws just that image with a tweaked look. The
// semantics are "override only what you set": the description is prefilled and
// editable, and every other field starts blank/"Keep" meaning "use the game's saved
// setting". Only a field you actually fill is sent as a per-call override — so this
// never mutates the campaign's settings, it just shadows them for one regenerate.
// Seed and the model picker are local-engine only (grok ignores them), so the model
// picker shows only when ComfyUI reported installed checkpoints.

interface ImageEditorProps {
  /** Prefilled, editable prompt — the description that made the current image. */
  initialDescription: string;
  /** Installed ComfyUI checkpoints (from getImageModels); [] hides the model picker. */
  imageModels: string[];
  /** ADR-0036/0037: the campaign-relative path of the image being edited. Enables the
   * "change amount" (img2img init) and "keep the face" (reference) controls; absent
   * hides them. */
  currentImageRelPath?: string;
  busy: boolean;
  error?: string | null;
  /** Redraw this image. `overrides` carries only the fields the user set. */
  onRegenerate: (description: string, overrides: ImageOverrides) => void;
  onClose: () => void;
}

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

export function ImageEditor({
  initialDescription,
  imageModels,
  currentImageRelPath,
  busy,
  error,
  onRegenerate,
  onClose,
}: ImageEditorProps) {
  const [description, setDescription] = useState(initialDescription);
  const [artStyle, setArtStyle] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [seed, setSeed] = useState("");
  const [model, setModel] = useState("");
  // Tri-state: "" = keep the game's quality; otherwise the chosen tier.
  const [quality, setQuality] = useState<"" | "fast" | "standard" | "high">("");
  // ADR-0036: img2img — tweak the current image instead of drawing fresh.
  const [tweak, setTweak] = useState(false);
  const [changeAmount, setChangeAmount] = useState(0.65); // ComfyUI denoise
  // ADR-0037: IP-Adapter likeness — keep the current subject's face.
  const [keepFace, setKeepFace] = useState(false);
  const [likeness, setLikeness] = useState(0.5);
  const [refPhoto, setRefPhoto] = useState<string>(""); // base64 data URL, optional override

  function redraw() {
    const overrides: ImageOverrides = {};
    if (artStyle.trim()) overrides.artStyle = artStyle.trim();
    if (negativePrompt.trim()) overrides.negativePrompt = negativePrompt.trim();
    if (model) overrides.imageModel = model;
    if (quality) overrides.imageQuality = quality;
    const t = seed.trim();
    if (t !== "") {
      const n = Number(t);
      if (Number.isFinite(n) && n >= 0) overrides.imageSeed = Math.floor(n);
    } else {
      // #166: a blank seed used to fall back to the deterministic per-scene seed on the
      // backend, so every redraw reused the identical noise field and the image barely
      // moved. Redraw is an explicit "give me a different take", so send a fresh random
      // seed each time; a typed seed still pins. (First-time auto-illustration is a
      // different path and keeps its deterministic seed.)
      overrides.imageSeed = Math.floor(Math.random() * 2 ** 31);
    }
    // ADR-0036: img2img needs the current image as the init frame.
    if (tweak && currentImageRelPath) {
      overrides.initImageRelPath = currentImageRelPath;
      overrides.denoise = changeAmount;
    }
    // ADR-0037: likeness — an uploaded photo wins, else the current image is the reference.
    if (keepFace) {
      if (refPhoto) overrides.referencePhoto = refPhoto;
      else if (currentImageRelPath) overrides.referenceImageRelPath = currentImageRelPath;
      overrides.likenessStrength = likeness;
    }
    onRegenerate(description.trim() || initialDescription, overrides);
  }

  function onPickPhoto(file: File | undefined) {
    if (!file) {
      setRefPhoto("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setRefPhoto(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  }

  return (
    <div
      data-testid="image-editor"
      onClick={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        maxWidth: 480,
        marginTop: 14,
        boxSizing: "border-box",
        background: "rgba(20,14,9,.96)",
        border: "1px solid rgba(184,150,90,.4)",
        borderRadius: 8,
        padding: "12px 14px",
        textAlign: "left",
        maxHeight: "48vh",
        overflowY: "auto",
      }}
    >
      <div style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: 1, color: "var(--brass)" }}>
        EDIT &amp; REDRAW
      </div>
      <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 2 }}>
        Change only what you set — everything left blank keeps this game's look.
      </div>

      <div style={labelStyle}>Prompt</div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        data-testid="editor-prompt"
        rows={3}
        style={{ ...fieldStyle, resize: "vertical" }}
      />

      <div style={labelStyle}>Art style — blank keeps the game's</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {ART_PRESETS.map((preset) => {
          const selected = artStyle === preset;
          return (
            <button
              key={preset}
              data-testid="editor-art-preset"
              onClick={() => setArtStyle(selected ? "" : preset)}
              style={{
                cursor: "pointer",
                padding: "5px 10px",
                borderRadius: 16,
                fontFamily: "var(--font-body)",
                fontSize: 11.5,
                background: selected ? "rgba(211,112,60,.9)" : "rgba(28,20,12,.5)",
                border: `1px solid ${selected ? "rgba(211,112,60,.9)" : "rgba(109,90,56,.36)"}`,
                color: selected ? "#fbeede" : "var(--ink-dim)",
              }}
            >
              {PRESET_LABELS[preset] ?? preset}
            </button>
          );
        })}
      </div>
      <input
        value={ART_PRESETS.includes(artStyle) ? "" : artStyle}
        onChange={(e) => setArtStyle(e.target.value)}
        data-testid="editor-art-custom"
        placeholder="or a custom style…"
        style={{ ...fieldStyle, marginTop: 6, fontStyle: "italic" }}
      />

      <div style={labelStyle}>Negative prompt — things to keep out</div>
      <textarea
        value={negativePrompt}
        onChange={(e) => setNegativePrompt(e.target.value)}
        data-testid="editor-negative"
        rows={2}
        placeholder="blurry, extra fingers, text…"
        style={{ ...fieldStyle, resize: "vertical" }}
      />

      <div style={labelStyle}>Quality — local engine</div>
      <div style={{ display: "flex", gap: 5 }}>
        {(["", "fast", "standard", "high"] as const).map((q) => {
          const active = quality === q;
          return (
            <button
              key={q || "keep"}
              data-testid="editor-quality"
              data-quality={q || "keep"}
              onClick={() => setQuality(q)}
              style={{
                flex: 1,
                cursor: "pointer",
                padding: "6px 4px",
                borderRadius: 6,
                fontFamily: "var(--font-body)",
                fontSize: 11,
                textTransform: "capitalize",
                background: active ? "rgba(124,61,32,.28)" : "rgba(28,20,12,.5)",
                border: `1px solid ${active ? "rgba(211,112,60,.6)" : "rgba(109,90,56,.32)"}`,
                color: active ? "var(--ink)" : "var(--ink-faint)",
              }}
            >
              {q || "Keep"}
            </button>
          );
        })}
      </div>

      <div style={labelStyle}>Seed — blank = a new image each redraw · type a number to pin it · local engine</div>
      <input
        value={seed}
        inputMode="numeric"
        onChange={(e) => setSeed(e.target.value)}
        data-testid="editor-seed"
        placeholder="new each redraw"
        style={fieldStyle}
      />

      {imageModels.length > 0 && (
        <>
          <div style={labelStyle}>Base model — local engine</div>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            data-testid="editor-model"
            style={fieldStyle}
          >
            <option value="">Keep the game's model</option>
            {imageModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </>
      )}

      {/* ADR-0036: img2img "change amount" — tweak the current image instead of a
          fresh draw. Only offered when there is a current image to build on, and on
          the local engine (grok ignores it). */}
      {currentImageRelPath && (
        <div style={{ marginTop: 12, borderTop: "1px solid rgba(109,90,56,.3)", paddingTop: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              data-testid="editor-tweak"
              checked={tweak}
              onChange={(e) => setTweak(e.target.checked)}
            />
            <span style={{ fontSize: 12.5, color: "var(--ink)" }}>Tweak this image (keep the composition)</span>
          </label>
          {tweak && (
            <div style={{ marginTop: 6 }}>
              <div style={labelStyle}>
                Change amount <span style={{ color: "var(--ink-faint)" }}>— {changeAmount.toFixed(2)} · higher = more different · local engine</span>
              </div>
              <input
                type="range"
                data-testid="editor-change-amount"
                min={0.2}
                max={0.9}
                step={0.05}
                value={changeAmount}
                onChange={(e) => setChangeAmount(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
          )}
        </div>
      )}

      {/* ADR-0037: IP-Adapter likeness — keep the current subject's face. */}
      {currentImageRelPath && (
        <div style={{ marginTop: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              data-testid="editor-keep-face"
              checked={keepFace}
              onChange={(e) => setKeepFace(e.target.checked)}
            />
            <span style={{ fontSize: 12.5, color: "var(--ink)" }}>Keep the character's face</span>
          </label>
          {keepFace && (
            <div style={{ marginTop: 6 }}>
              <div style={labelStyle}>
                Likeness <span style={{ color: "var(--ink-faint)" }}>— {likeness.toFixed(2)} · local engine · needs IP-Adapter</span>
              </div>
              <input
                type="range"
                data-testid="editor-likeness"
                min={0.2}
                max={1.0}
                step={0.05}
                value={likeness}
                onChange={(e) => setLikeness(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{ ...labelStyle, marginTop: 8 }}>
                Reference photo <span style={{ color: "var(--ink-faint)" }}>— optional; blank uses this image</span>
              </div>
              <input
                type="file"
                accept="image/*"
                data-testid="editor-ref-photo"
                onChange={(e) => onPickPhoto(e.target.files?.[0])}
                style={{ fontSize: 11.5, color: "var(--ink-dim)" }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div data-testid="editor-error" style={{ marginTop: 10, fontSize: 11, color: "var(--ember)", lineHeight: 1.3 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          data-testid="editor-redraw"
          onClick={redraw}
          disabled={busy}
          style={{
            flex: 1,
            cursor: busy ? "default" : "pointer",
            padding: "9px 0",
            borderRadius: 6,
            border: "none",
            background: busy ? "rgba(120,90,60,.5)" : "linear-gradient(180deg,#d8743e,#a8511f)",
            color: "#1c120a",
            fontFamily: "var(--font-display)",
            fontSize: 12.5,
          }}
        >
          {busy ? "Drawing…" : "Redraw"}
        </button>
        <button
          data-testid="editor-cancel"
          onClick={onClose}
          disabled={busy}
          style={{
            flex: 1,
            cursor: "pointer",
            padding: "9px 0",
            borderRadius: 6,
            border: "1px solid rgba(109,90,56,.5)",
            background: "transparent",
            color: "var(--ink-dim)",
            fontFamily: "var(--font-display)",
            fontSize: 12.5,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
