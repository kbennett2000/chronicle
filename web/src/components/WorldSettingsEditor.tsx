import { useState } from "react";
import type { CampaignSettings, CampaignSettingsPatch, ResponseLength } from "../lib/campaign";
import { ToggleRow } from "./LookControls";

// Shared "THE WORLD" controls, lifted out of the Settings screen (issue #114)
// so the main Settings screen (account defaults) and the in-game settings screen
// (this game) share one implementation. Purely presentational: `onPatch` applies
// each change immediately; the host owns the persistence endpoint.

const INTENSITY_OPTIONS: Array<{ id: "standard" | "low"; label: string; note: string }> = [
  { id: "standard", label: "Standard", note: "Full range of humour and description." },
  { id: "low", label: "Low", note: "No crude humour; violence stays non-graphic." },
];

// Issue #69: how long/detailed the DM's replies run. Absent === "detailed".
const LENGTH_OPTIONS: Array<{ id: ResponseLength; label: string; note: string }> = [
  { id: "concise", label: "Concise", note: "Short replies that mirror your input length." },
  { id: "standard", label: "Standard", note: "A paragraph or two, scaling with the scene." },
  { id: "detailed", label: "Detailed", note: "Rich, immersive, multi-paragraph narration." },
];

function whimsyLabel(value: number): string {
  if (value < 0.22) return "Grounded";
  if (value < 0.45) return "A little strange";
  if (value < 0.7) return "Often strange";
  return "Deeply strange";
}

interface WorldSettingsEditorProps {
  value: Pick<CampaignSettings, "worldSetting" | "toneWhimsy" | "contentIntensity" | "responseLength" | "autoRollDice">;
  onPatch: (patch: CampaignSettingsPatch) => void;
}

export function WorldSettingsEditor({ value, onPatch }: WorldSettingsEditorProps) {
  // Local draft so the label tracks the slider live; committed via onPatch.
  const [whimsyDraft, setWhimsyDraft] = useState(value.toneWhimsy ?? 0);

  return (
    <>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 6 }}>
        Setting <span style={{ color: "var(--ink-faint)" }}>— empty keeps standard fantasy</span>
      </div>
      <input
        defaultValue={value.worldSetting ?? ""}
        onBlur={(e) => onPatch({ worldSetting: e.target.value.trim() })}
        placeholder="e.g. underwater merfolk city-states…"
        data-testid="world-setting-input"
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "rgba(12,8,5,.5)",
          border: "1px solid rgba(109,90,56,.4)",
          borderRadius: 4,
          padding: "11px 13px",
          color: "var(--ink)",
          fontFamily: "var(--font-body)",
          fontStyle: "italic",
          fontSize: 14,
          outline: "none",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0 5px" }}>
        <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>Tone &amp; whimsy</span>
        <span
          data-testid="whimsy-label"
          style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 1, color: "var(--ember)" }}
        >
          {whimsyLabel(whimsyDraft)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={whimsyDraft}
        onChange={(e) => {
          const next = Number(e.target.value);
          setWhimsyDraft(next);
          onPatch({ toneWhimsy: next });
        }}
        data-testid="whimsy-slider"
        style={{ width: "100%", accentColor: "#d3703c", height: 4 }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3 }}>
        <span>grounded</span>
        <span>deeply strange</span>
      </div>

      <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "18px 0 6px" }}>Content intensity</div>
      <div style={{ display: "flex", gap: 7 }}>
        {INTENSITY_OPTIONS.map((option) => {
          const selected = (value.contentIntensity ?? "standard") === option.id;
          return (
            <button
              key={option.id}
              data-testid="intensity-option"
              data-selected={selected}
              onClick={() => onPatch({ contentIntensity: option.id })}
              style={{
                flex: 1,
                cursor: "pointer",
                textAlign: "left",
                padding: "11px 13px",
                borderRadius: 4,
                background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
              }}
            >
              <div style={{ fontFamily: "var(--font-display)", fontSize: 13, color: selected ? "#efe6d2" : "var(--ink-dim)" }}>
                {option.label}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3, lineHeight: 1.35 }}>{option.note}</div>
            </button>
          );
        })}
      </div>

      {/* Issue #69: how long/detailed the DM's replies run. Absent === detailed. */}
      <div style={{ fontSize: 12, color: "var(--ink-dim)", margin: "18px 0 6px" }}>Reply length</div>
      <div style={{ display: "flex", gap: 7 }}>
        {LENGTH_OPTIONS.map((option) => {
          const selected = (value.responseLength ?? "detailed") === option.id;
          return (
            <button
              key={option.id}
              data-testid="length-option"
              data-selected={selected}
              onClick={() => onPatch({ responseLength: option.id })}
              style={{
                flex: 1,
                cursor: "pointer",
                textAlign: "left",
                padding: "11px 13px",
                borderRadius: 4,
                background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
              }}
            >
              <div style={{ fontFamily: "var(--font-display)", fontSize: 13, color: selected ? "#efe6d2" : "var(--ink-dim)" }}>
                {option.label}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 3, lineHeight: 1.35 }}>{option.note}</div>
            </button>
          );
        })}
      </div>

      {/* Issue #44: engine rolls dice by default; off = you provide values. */}
      <ToggleRow
        testId="dice-toggle"
        title="Auto-roll dice"
        description="On: the DM rolls for you · Off: you supply your own roll values"
        checked={value.autoRollDice !== false} // absent === on
        onChange={(next) => onPatch({ autoRollDice: next })}
        containerStyle={{ margin: "18px 0 0" }}
      />
    </>
  );
}
