/** Generic markdown-heading sectioning, shared by every panel that reads
 * state off a markdown state file (worldState here; npcRoster/questLog in
 * later slices use the same function to pull out "## <NPC name>" or
 * "## Active" blocks — this is deliberately not bespoke to the one
 * "Current Situation" field). */
export interface MarkdownSection {
  level: number;
  heading: string;
  /** Raw markdown between this heading and the next heading of an equal
   * or shallower level (trimmed). */
  body: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;

/** npc-roster.md's own template (see scripts/scratch-campaign.ts's
 * EMPTY_NPC_ROSTER) ships an HTML comment showing the `## <Name>` entry
 * format as a worked example — including a literal `##`-prefixed line.
 * Left un-stripped, that reads as a real heading with a fake "<Name>"
 * NPC, which is exactly the brand-new/zero-NPCs case this needs to
 * render as a clean empty state, not a bogus entry. Comments are never
 * meaningful content in any state file, so stripping them here (once,
 * for every section-based parser) is correct for worldState/questLog
 * too, not just npcRoster. */
function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

export function parseMarkdownSections(rawMarkdown: string): MarkdownSection[] {
  const markdown = stripHtmlComments(rawMarkdown);
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (current) sections.push({ ...current, body: bodyLines.join("\n").trim() });
    bodyLines = [];
  };

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      flush();
      current = { level: match[1].length, heading: match[2], body: "" };
    } else if (current) {
      bodyLines.push(line);
    }
  }
  flush();

  return sections;
}

/** First section whose heading matches (case-insensitive, whitespace-
 * trimmed) — headings are the DM engine's own free text, not a rigid
 * schema, so this is intentionally forgiving about case. It is NOT
 * forgiving about the heading text itself changing (a renamed or
 * misspelled heading in the system prompt silently yields `undefined`
 * here, not an error) — worth knowing before leaning on this for
 * anything more load-bearing than display copy. */
export function findMarkdownSection(markdown: string, heading: string): MarkdownSection | undefined {
  const target = heading.trim().toLowerCase();
  const found = parseMarkdownSections(markdown).find((s) => s.heading.trim().toLowerCase() === target);
  if (!found) {
    // Not an error (the file is still valid markdown) but not silent
    // either — this is the one thing standing between a renamed heading
    // in the DM engine's system prompt and this just quietly rendering
    // nothing, forever.
    console.warn(`[markdown] expected heading "${heading}" not found`);
  }
  return found;
}

const BULLET_FIELD_RE = /^-\s*\*\*([^*]+):\*\*\s?(.*)$/;

/** Second parsing pass, flagged by the Slice 14 plan, for a section's
 * `- **Field:** value` bullets (npc-roster.md's per-NPC entries; quest-
 * log/views entries later reuse this same shape). A field's value can
 * wrap onto un-bulleted continuation lines — npc-roster.md's real
 * entries do this for longer "Knows" text — so any non-bullet, non-blank
 * line is appended to whatever field came before it; a blank line ends
 * that continuation. */
export function parseBulletFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let currentKey: string | null = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      currentKey = null;
      continue;
    }
    const match = BULLET_FIELD_RE.exec(line);
    if (match) {
      currentKey = match[1].trim();
      fields[currentKey] = match[2].trim();
    } else if (currentKey) {
      fields[currentKey] = `${fields[currentKey]} ${line}`.trim();
    }
  }

  return fields;
}
