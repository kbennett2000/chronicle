import { parseMarkdownSections } from "./markdown";

export type LogEntry =
  | { type: "chapter"; text: string }
  | { type: "narration"; text: string; isError?: boolean }
  | { type: "player"; text: string };

/** Re-joins one session-log heading's body into per-turn bullets: each
 * "- ..." line starts a new bullet, and indented continuation lines (the
 * file wraps long bullets across multiple lines, no leading "-") are
 * appended to it. See tests/e2e/turn.spec.ts's fixture data, or any real
 * campaigns/test-campaign/session-log/*.md file, for the actual shape. */
function splitBullets(body: string): string[] {
  const bullets: string[] = [];
  let current: string[] | null = null;

  for (const line of body.split(/\r?\n/)) {
    const bulletMatch = /^-\s+(.*\S)\s*$/.exec(line);
    if (bulletMatch) {
      if (current) bullets.push(current.join(" "));
      current = [bulletMatch[1]];
    } else if (current && line.trim() !== "") {
      current.push(line.trim());
    }
  }
  if (current) bullets.push(current.join(" "));
  return bullets;
}

/** Hydrates history from a currentSessionLog.content markdown blob:
 * "# Session <timestamp>" headings become chapter entries, and each
 * bullet under one becomes a narration entry.
 *
 * Important gap: the persisted file is a flat list of terse, already-
 * summarized DM-voice bullets, one per turn — it does NOT preserve which
 * part was the player's action vs. the DM's narration, and there's no
 * "story event" (first-NPC-appearance) marker either. That distinction
 * only exists for turns happening live in the current session (see
 * lib/campaign.ts's sendTurn and how Play.tsx appends "player" entries
 * itself) — it cannot be reconstructed from history. */
export function parseSessionLog(markdown: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const section of parseMarkdownSections(markdown)) {
    entries.push({ type: "chapter", text: section.heading });
    for (const bullet of splitBullets(section.body)) {
      entries.push({ type: "narration", text: bullet });
    }
  }
  return entries;
}
