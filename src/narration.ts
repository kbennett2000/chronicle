/** Issue #46: the DM engine narrates its own file-bookkeeping between tool
 * calls ("Let me update state.", "Back to the story:"), and runTurn concatenates
 * every assistant text block verbatim with no separator, so that meta-chatter
 * leaks into player-facing narration (often glued to real prose:
 * "...update state.Back to the story:There's firelight ahead...").
 *
 * stripMetaChatter removes those bookkeeping segues. It is deliberately
 * CONSERVATIVE — it only strips a sentence when a bookkeeping verb
 * (update/record/save/write/log) is paired with a state/file object, plus the
 * specific "back to the story" segue. Ordinary prose that merely mentions
 * "state" ("the state of the kingdom", "let me see the state room") is left
 * untouched because it lacks that verb+object pairing. The prompt is the first
 * line of defense (it tells the model not to emit this at all); this is the
 * safety net for when it does anyway. */

const META_PATTERNS: RegExp[] = [
  // "Let me / I'll / I need to — update|record|save|write|log ... state|files|sheet|roster|quest log|inventory ..."
  /\b(?:let me|i['’]ll|i will|i need to|now,?\s*(?:let me|i['’]ll)|first,?\s*let me)\b[^.!?\n]*?\b(?:update|record|save|writ(?:e|ing)|log|jot|note)\b[^.!?\n]*?\b(?:state|files?|character[-\s]?sheet|the sheet|world[-\s]?state|quest[-\s]?log|npc[-\s]?roster|inventory|hp)\b[^.!?\n]*?[.!?:]/gi,
  // Bare gerund bookkeeping: "Updating the character sheet now." / "Saving state."
  /\b(?:updating|saving|recording|writing|logging)\b[^.!?\n]*?\b(?:state|files?|character[-\s]?sheet|the sheet|world[-\s]?state|quest[-\s]?log|npc[-\s]?roster)\b[^.!?\n]*?[.!?:]/gi,
  // Segues back into fiction.
  /\b(?:now\s+)?back to (?:the )?(?:story|action|game|narration|scene)\b[.!?:]?/gi,
];

export function stripMetaChatter(text: string): string {
  if (!text) return text;
  // Repair the run-together join first: textParts.join("") glues a sentence's
  // end punctuation to the next block's capital ("state.Back"), which both
  // reads badly and can hide a boundary from the patterns below.
  let out = text.replace(/([.!?:])(?=[A-Z"'“‘])/g, "$1 ");
  for (const re of META_PATTERNS) out = out.replace(re, "");
  // Tidy the whitespace the removals open up, without collapsing intended
  // paragraph breaks.
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
