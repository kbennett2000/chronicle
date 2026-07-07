import type { ReactNode } from "react";
import type { ModelOption, ProviderOption } from "../lib/campaign";

// Shared "THE ENGINE" control — the provider toggle + model radio list, lifted
// out of the Settings screen (issue #114) so it can serve two hosts:
//   • the main Settings screen, editing the ACCOUNT DEFAULT engine/model that
//     new chronicles inherit (fully interactive), and
//   • the in-game settings screen, where the engine/model are LOCKED once play
//     has begun (readOnly) — a mid-game switch left a stale session id the wrong
//     backend tried to resume and crashed (ADR-0018, #57, #114). The backend
//     enforces the lock too (POST /session/start → 409); this just hides the
//     control that would trip it.
//
// Purely presentational: the caller owns persistence (account defaults write
// /me/settings; the new-game engine is chosen at creation). No session/start.

interface EnginePickerProps {
  providers: ProviderOption[];
  /** Fallback flat model list when the providers array is empty (older server). */
  models: ModelOption[];
  provider: string;
  model: string;
  onPickProvider: (id: string) => void;
  onPickModel: (id: string) => void;
  /** #114: render the current engine/model as locked (disabled + a note). */
  readOnly?: boolean;
  /** Optional status/hint line rendered beneath the picker (host owns copy). */
  status?: ReactNode;
}

export function EnginePicker({
  providers,
  models,
  provider,
  model,
  onPickProvider,
  onPickModel,
  readOnly = false,
  status,
}: EnginePickerProps) {
  const modelList = providers.find((p) => p.id === provider)?.models ?? models;
  return (
    <>
      {providers.length > 0 && (
        <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
          {providers.map((p) => {
            const active = provider === p.id;
            return (
              <button
                key={p.id}
                data-testid="provider-option"
                data-selected={active}
                disabled={readOnly}
                title={p.label}
                onClick={readOnly ? undefined : () => onPickProvider(p.id)}
                style={{
                  flex: 1,
                  cursor: readOnly ? "default" : "pointer",
                  opacity: readOnly && !active ? 0.5 : 1,
                  padding: "9px 12px",
                  borderRadius: 4,
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 13,
                  color: active ? "var(--ink)" : "var(--ink-faint)",
                  background: active ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
                  border: `1px solid ${active ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
                }}
              >
                {p.label.split("—")[0].trim()}
              </button>
            );
          })}
        </div>
      )}
      {modelList.map((option) => {
        const selected = model === option.id;
        // #114: in read-only mode only the active model is shown — the list of
        // alternatives would imply a switch that isn't allowed mid-game.
        if (readOnly && !selected) return null;
        return (
          <button
            key={option.id}
            data-testid="model-option"
            data-selected={selected}
            disabled={readOnly}
            onClick={readOnly ? undefined : () => onPickModel(option.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              cursor: readOnly ? "default" : "pointer",
              marginBottom: 7,
              padding: "12px 14px",
              borderRadius: 4,
              background: selected ? "rgba(124,61,32,.24)" : "rgba(28,20,12,.5)",
              border: `1px solid ${selected ? "rgba(211,112,60,.55)" : "rgba(109,90,56,.32)"}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>
                {option.label}
              </span>
              {readOnly ? (
                <span style={{ fontSize: 15, color: "var(--ink-faint)" }} aria-hidden>
                  🔒
                </span>
              ) : (
                <span
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: "50%",
                    border: `1.5px solid ${selected ? "#d3703c" : "#6d5a38"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: selected ? "#d3703c" : "transparent" }} />
                </span>
              )}
            </div>
          </button>
        );
      })}
      {status}
    </>
  );
}
