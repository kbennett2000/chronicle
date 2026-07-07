import type { CampaignSettings, CampaignSettingsPatch } from "../lib/campaign";
import { ToggleRow, ArtStylePicker } from "./LookControls";

// Shared "THE LOOK" controls, lifted out of the Settings screen (issue #114) so
// the main Settings screen (editing account defaults) and the in-game settings
// screen (editing this game) render the exact same UI and differ only in where
// the caller persists. Purely presentational: `onPatch` applies each change
// immediately — the host owns the endpoint (/me/settings vs /campaigns/:id/settings).

interface LookSettingsEditorProps {
  value: Pick<CampaignSettings, "generateImages" | "autoIllustrateTurns" | "artStyle">;
  onPatch: (patch: CampaignSettingsPatch) => void;
}

export function LookSettingsEditor({ value, onPatch }: LookSettingsEditorProps) {
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
          when scene art is on, since it needs Grok Build too. */}
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

      <ArtStylePicker artStyle={value.artStyle ?? ""} onChange={(style) => onPatch({ artStyle: style })} />
    </>
  );
}
