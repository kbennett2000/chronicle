import type { CampaignSettings, CampaignSettingsPatch } from "../lib/campaign";
import {
  ToggleRow,
  ArtStylePicker,
  ImageProviderPicker,
  ImageQualityPicker,
  NegativePromptField,
  SeedField,
  ModelPicker,
} from "./LookControls";

// Shared "THE LOOK" controls, lifted out of the Settings screen (issue #114) so
// the main Settings screen (editing account defaults) and the in-game settings
// screen (editing this game) render the exact same UI and differ only in where
// the caller persists. Purely presentational: `onPatch` applies each change
// immediately — the host owns the endpoint (/me/settings vs /campaigns/:id/settings).

interface LookSettingsEditorProps {
  value: Pick<
    CampaignSettings,
    | "generateImages"
    | "autoIllustrateTurns"
    | "artStyle"
    | "imageProvider"
    | "imageQuality"
    | "negativePrompt"
    | "imageSeed"
    | "imageModel"
  >;
  onPatch: (patch: CampaignSettingsPatch) => void;
  /** #154: installed ComfyUI checkpoints (from getImageModels). The model picker
   * shows only when this is non-empty and the engine is local. Defaults to []. */
  imageModels?: string[];
}

export function LookSettingsEditor({ value, onPatch, imageModels = [] }: LookSettingsEditorProps) {
  const isLocal = (value.imageProvider ?? "grok") === "local";
  return (
    <>
      <ToggleRow
        testId="images-toggle"
        title="Generate scene art"
        description="Off by default · needs Grok Build configured"
        checked={!!value.generateImages}
        onChange={(next) => onPatch({ generateImages: next })}
      />

      {/* Issue #56: auto-illustrate each turn — only meaningful (and only shown)
          when scene art is on, since it needs an image engine too. */}
      {value.generateImages && (
        <ToggleRow
          testId="auto-illustrate-toggle"
          title="Auto-illustrate each turn"
          description="Draws every DM reply · the image appears a moment after the text"
          checked={!!value.autoIllustrateTurns}
          onChange={(next) => onPatch({ autoIllustrateTurns: next })}
          containerStyle={{ marginTop: 8 }}
        />
      )}

      {/* ADR-0027: which engine draws images — only shown when scene art is on. */}
      {value.generateImages && (
        <ImageProviderPicker
          value={value.imageProvider ?? "grok"}
          onChange={(provider) => onPatch({ imageProvider: provider })}
        />
      )}

      {/* ADR-0029: local-engine quality tier — only shown when scene art is on. */}
      {value.generateImages && (
        <ImageQualityPicker
          value={value.imageQuality ?? "standard"}
          onChange={(quality) => onPatch({ imageQuality: quality })}
        />
      )}

      <ArtStylePicker artStyle={value.artStyle ?? ""} onChange={(style) => onPatch({ artStyle: style })} />

      {/* #154: user negative prompt — applies to both engines, shown whenever scene art is on. */}
      {value.generateImages && (
        <NegativePromptField
          value={value.negativePrompt ?? ""}
          onChange={(negativePrompt) => onPatch({ negativePrompt })}
        />
      )}

      {/* #154: seed override — local engine only (grok ignores it). */}
      {value.generateImages && isLocal && (
        <SeedField value={value.imageSeed} onChange={(imageSeed) => onPatch({ imageSeed })} />
      )}

      {/* #154: base-checkpoint picker — local engine only, and only when ComfyUI
          actually reports installed checkpoints. */}
      {value.generateImages && isLocal && imageModels.length > 0 && (
        <ModelPicker
          value={value.imageModel ?? ""}
          models={imageModels}
          onChange={(imageModel) => onPatch({ imageModel })}
        />
      )}
    </>
  );
}
