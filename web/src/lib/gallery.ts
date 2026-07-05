import { findMarkdownSection } from "./markdown";
import { parseNpcRoster } from "./npc-roster";
import { LOCATIONS_VISITED_HEADING } from "./state-headings";
import type { CharacterSheet } from "./campaign";

export type GalleryEntityType = "character" | "npc" | "location";

export interface GalleryItem {
  type: GalleryEntityType;
  name: string;
  image?: string;
  /** A short visual description used to seed on-demand illustration
   * (ADR-0009). Best-effort — falls back to the name if none is recorded. */
  description?: string;
}

const TOP_BULLET_RE = /^-\s*\*\*([^*]+)\*\*\s*(?:[—-]\s*)?(.*)$/;
// image-generator.ts's tool instructions tell the model to record a
// location's image as freeform prose — "an 'Image' line under the
// location's world-state.md bullet" — not a fixed `- **Field:** value`
// bullet like npc-roster.md's "Portrait asset ID". This tolerates a
// leading bullet dash and/or bold markers around the word "Image".
const IMAGE_LINE_RE = /^-?\s*\*{0,2}Image\*{0,2}:\s*(.+)$/i;

function normalizeImageValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || /^\(.*\)$/.test(trimmed)) return undefined;
  return trimmed;
}

/** world-state.md's "## Locations Visited" section is the same freeform-
 * bullet shape as quest-log.md's Active/Completed sections (see
 * lib/quest-log.ts) — one top-level `- **Location name** — description`
 * bullet per location, not a `## <Name>` heading per entry. Only a
 * location's name and (if ever generated) image path matter for the
 * gallery, so this doesn't carry the full continuation-line reassembly
 * quest-log.ts needs for its prose detail/progress fields. */
function parseLocations(body: string): Array<{ name: string; image?: string; description?: string }> {
  const entries: Array<{ name: string; image?: string; description?: string }> = [];
  let current: { name: string; image?: string; description?: string } | null = null;

  const flush = () => {
    if (current) entries.push(current);
    current = null;
  };

  for (const rawLine of body.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const line = rawLine.trim();
    const indented = /^[ \t]/.test(rawLine);

    if (!indented) {
      if (!line.startsWith("-")) continue;
      flush();
      const match = TOP_BULLET_RE.exec(line);
      current = match
        ? { name: match[1].trim(), description: match[2].trim() || undefined }
        : { name: line.replace(/^-\s*/, "").trim() };
      continue;
    }

    if (!current) continue;

    const imageMatch = IMAGE_LINE_RE.exec(line);
    if (imageMatch) current.image = normalizeImageValue(imageMatch[1]);
  }
  flush();

  return entries;
}

/** Per docs/design/handoff-2026-07/README.md: "there is no 'list images'
 * endpoint — gallery is assembled by reading image filenames out of
 * worldState / npcRoster / characterSheet entries." All three sources
 * are already fetched by Play.tsx for their own panels — this just
 * re-reads them into one flat list, entity-type-tagged. */
export function buildGallery(characterSheet: CharacterSheet, npcRoster: string, worldState: string): GalleryItem[] {
  const characterDescription = [characterSheet.name, "a", `level ${characterSheet.level}`, characterSheet.race, characterSheet.class]
    .filter(Boolean)
    .join(" ");
  const items: GalleryItem[] = [
    {
      type: "character",
      name: characterSheet.name,
      image: normalizeImageValue(characterSheet.portraitImage),
      description: characterDescription,
    },
  ];

  for (const npc of parseNpcRoster(npcRoster)) {
    items.push({ type: "npc", name: npc.name, image: npc.portraitImage, description: npc.description });
  }

  const locations = findMarkdownSection(worldState, LOCATIONS_VISITED_HEADING);
  if (locations) {
    for (const location of parseLocations(locations.body)) {
      items.push({ type: "location", name: location.name, image: location.image, description: location.description });
    }
  }

  return items;
}
