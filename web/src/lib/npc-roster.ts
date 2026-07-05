import { parseMarkdownSections, parseBulletFields } from "./markdown";
import { NPC_DESCRIPTION_FIELD, NPC_DISPOSITION_FIELD, NPC_KNOWS_FIELD, NPC_PORTRAIT_FIELD } from "./state-headings";

export interface NpcEntry {
  name: string;
  description?: string;
  disposition?: string;
  knows?: string;
  /** The "Portrait asset ID" bullet's value, or undefined if never
   * generated — its placeholder text ("(none yet)") and an empty value
   * both mean "no portrait," same as the field being absent entirely.
   * May still carry the "images/" prefix from image-generator.ts's
   * relPath; lib/useAuthedImage.ts strips that down to a basename. */
  portraitImage?: string;
}

const REQUIRED_FIELDS = [NPC_DESCRIPTION_FIELD, NPC_DISPOSITION_FIELD, NPC_KNOWS_FIELD];

function normalizePortraitValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || /^\(.*\)$/.test(trimmed)) return undefined; // "(none yet)" placeholder
  return trimmed;
}

/** Every `## <NPC Name>` section in npcRoster is one roster entry — the
 * "## NPC Roster" h1 itself and any HTML-comment-only template text are
 * already excluded by parseMarkdownSections (level !== 2, and comments
 * are stripped before sectioning). Per Slice 17's console.warn
 * discipline (see lib/markdown.ts's findMarkdownSection): a section
 * missing an expected field is rendered with whatever it does have, not
 * dropped or crashed on, but the miss is logged so a DM-engine prompt
 * drift is debuggable instead of just quietly missing content. */
export function parseNpcRoster(markdown: string): NpcEntry[] {
  return parseMarkdownSections(markdown)
    .filter((section) => section.level === 2)
    .map((section) => {
      const fields = parseBulletFields(section.body);
      for (const field of REQUIRED_FIELDS) {
        if (!fields[field]) {
          console.warn(`[npc-roster] NPC "${section.heading}" section missing expected field "${field}"`);
        }
      }
      return {
        name: section.heading,
        description: fields[NPC_DESCRIPTION_FIELD] || undefined,
        disposition: fields[NPC_DISPOSITION_FIELD] || undefined,
        knows: fields[NPC_KNOWS_FIELD] || undefined,
        portraitImage: normalizePortraitValue(fields[NPC_PORTRAIT_FIELD]),
      };
    });
}
