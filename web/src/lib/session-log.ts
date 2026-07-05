import { parseMarkdownSections } from "./markdown";

/** Chapter framing only — "# Session <timestamp>" headings out of a
 * currentSessionLog.content prose blob. That's the model's legitimate
 * literary framing (titles, retrospective narrative flavor) and stays
 * sourced from the prose log per ADR-0007.
 *
 * Turn-by-turn player-action/narration content is deliberately NOT parsed
 * from here — the prose log is a flat list of terse, already-summarized
 * DM-voice bullets that never preserved which part was the player's
 * literal action vs. the DM's literal narration. See
 * lib/campaign.ts's TurnTranscriptRecord (currentSessionLog.transcript)
 * for that: the server's own deterministic record, written at the moment
 * both strings are already in hand, which Play.tsx uses instead. */
export function parseChapterHeadings(markdown: string): string[] {
  return parseMarkdownSections(markdown).map((section) => section.heading);
}
