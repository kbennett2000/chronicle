import { parseQuestLog } from "../lib/quest-log";

interface QuestPanelProps {
  questLog: string;
}

/** No portraits, no checklist steps — quest-log.md's schema has neither a
 * per-quest image nor structured done/not-done step state (see
 * lib/quest-log.ts's QuestEntry doc comment). `progress` renders as the
 * freeform discovery/complication log it actually is, not a fabricated
 * checklist. */
export function QuestPanel({ questLog }: QuestPanelProps) {
  const { active, completed } = parseQuestLog(questLog);

  if (active.length === 0 && completed.length === 0) {
    return (
      <p style={{ fontStyle: "italic", color: "var(--ink-dim)", fontSize: 15, textAlign: "center", marginTop: 40 }}>
        No thread worth tracking has begun yet.
      </p>
    );
  }

  return (
    <div>
      {active.length > 0 && (
        <>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              letterSpacing: 1.5,
              color: "var(--ember)",
              marginBottom: 8,
            }}
          >
            ACTIVE
          </div>
          {active.map((quest, i) => (
            <div key={i} data-testid="quest-active" style={{ marginBottom: 16 }}>
              <div
                data-testid="quest-title"
                style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--ink)" }}
              >
                {quest.title}
              </div>
              {quest.detail && (
                <div
                  data-testid="quest-detail"
                  style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-dim)", fontStyle: "italic", margin: "3px 0 8px" }}
                >
                  {quest.detail}
                </div>
              )}
              {quest.progress.map((note, j) => (
                <div
                  key={j}
                  data-testid="quest-progress"
                  style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--ink-faint)", padding: "3px 0 3px 12px" }}
                >
                  {note}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {completed.length > 0 && (
        <>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              letterSpacing: 1.5,
              color: "var(--brass-dim)",
              margin: "6px 0 8px",
            }}
          >
            COMPLETED
          </div>
          {completed.map((quest, i) => (
            <div
              key={i}
              data-testid="quest-completed"
              style={{ display: "flex", alignItems: "baseline", gap: 9, padding: "4px 0" }}
            >
              <span
                data-testid="quest-completed-title"
                style={{ fontSize: 13, color: "var(--ink-faint)", textDecoration: "line-through" }}
              >
                {quest.title}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
