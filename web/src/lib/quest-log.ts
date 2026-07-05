import { findMarkdownSection } from "./markdown";
import { QUEST_ACTIVE_HEADING, QUEST_COMPLETED_HEADING } from "./state-headings";

/** quest-log.md's shape is NOT one heading per quest (unlike npc-roster.md's
 * "## <Name>" sections, per Slice 21) — every quest is a single top-level
 * `- **Title** — detail` bullet living inside one "## Active"/"## Completed"
 * section, with per-turn discoveries/complications logged as further-
 * indented nested bullets (themselves with wrapped continuation lines)
 * underneath. `progress` is that freeform prose log, not a checklist of
 * discrete done/not-done steps — quest-log.md's per-turn update discipline
 * (dm-engine.ts rule 6) never asks the DM to track step completion as
 * structured state, so there is no `done` boolean anywhere to render. */
export interface QuestEntry {
  title: string;
  detail?: string;
  progress: string[];
}

export interface QuestLog {
  active: QuestEntry[];
  completed: QuestEntry[];
}

const TOP_BULLET_RE = /^-\s*\*\*([^*]+)\*\*\s*(?:[—-]\s*)?(.*)$/;
const NESTED_BULLET_RE = /^-\s*(.*)$/;

function parseQuestSection(body: string): QuestEntry[] {
  const entries: QuestEntry[] = [];
  let current: QuestEntry | null = null;
  // Which field a following non-bullet continuation line should append to:
  // the quest's own detail, or a specific index into its progress notes.
  let target: "detail" | number | null = null;

  const flush = () => {
    if (current) entries.push(current);
    current = null;
    target = null;
  };

  for (const rawLine of body.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const indented = /^[ \t]/.test(rawLine);
    const line = rawLine.trim();

    if (!indented) {
      // A top-level, non-bullet line (e.g. the "_(none yet)_" placeholder)
      // has nothing to attach to — it isn't a new quest or a continuation.
      if (!line.startsWith("-")) continue;
      flush();
      const match = TOP_BULLET_RE.exec(line);
      current = match
        ? { title: match[1].trim(), detail: match[2].trim() || undefined, progress: [] }
        : { title: line.replace(/^-\s*/, "").trim(), progress: [] };
      target = "detail";
      continue;
    }

    if (!current) continue;

    const nested = line.startsWith("-") ? NESTED_BULLET_RE.exec(line) : null;
    if (nested) {
      current.progress.push(nested[1].trim());
      target = current.progress.length - 1;
      continue;
    }

    if (target === "detail") {
      current.detail = current.detail ? `${current.detail} ${line}` : line;
    } else if (typeof target === "number") {
      current.progress[target] = `${current.progress[target]} ${line}`.trim();
    }
  }
  flush();

  return entries;
}

export function parseQuestLog(markdown: string): QuestLog {
  const active = findMarkdownSection(markdown, QUEST_ACTIVE_HEADING);
  const completed = findMarkdownSection(markdown, QUEST_COMPLETED_HEADING);
  return {
    active: active ? parseQuestSection(active.body) : [],
    completed: completed ? parseQuestSection(completed.body) : [],
  };
}
