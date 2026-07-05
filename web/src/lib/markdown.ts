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

export function parseMarkdownSections(markdown: string): MarkdownSection[] {
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
  return parseMarkdownSections(markdown).find((s) => s.heading.trim().toLowerCase() === target);
}
