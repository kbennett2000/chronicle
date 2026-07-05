import type { Connection } from "../lib/connection";
import type { CharacterSheet } from "../lib/campaign";
import { useAuthedImage } from "../lib/useAuthedImage";

interface SelfPanelProps {
  connection: Connection;
  campaignId: string;
  sheet: CharacterSheet;
}

const ABILITIES: Array<{ key: keyof NonNullable<CharacterSheet["abilityScores"]>; label: string }> = [
  { key: "strength", label: "STR" },
  { key: "dexterity", label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom", label: "WIS" },
  { key: "charisma", label: "CHA" },
];

const COIN_ORDER: Array<{ key: "pp" | "gp" | "ep" | "sp" | "cp"; label: string }> = [
  { key: "pp", label: "pp" },
  { key: "gp", label: "gp" },
  { key: "ep", label: "ep" },
  { key: "sp", label: "sp" },
  { key: "cp", label: "cp" },
];

// Absent on a character sheet predating issue #4's currency migration —
// render as all-zero rather than erroring, per the backend contract's
// "design the missing-field case as normal, not an error."
const ZERO_CURRENCY = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

function modifier(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center", padding: "11px 4px", borderRadius: 4, background: "rgba(20,12,6,.35)", border: "1px solid rgba(109,90,56,.3)" }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: color ?? "var(--ink)" }}>{value}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: 1.5, color: "var(--ink-faint)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

function Portrait({ connection, campaignId, filename }: { connection: Connection; campaignId: string; filename: string | undefined }) {
  const url = useAuthedImage(connection, campaignId, filename);
  const boxStyle = { width: 76, height: 88, flexShrink: 0, borderRadius: 2, overflow: "hidden" as const };

  if (filename && url) {
    return (
      <div style={{ ...boxStyle, boxShadow: "0 4px 12px rgba(0,0,0,.5), 0 0 0 1px rgba(184,150,90,.5), inset 0 0 0 3px rgba(20,12,6,.4)" }}>
        <img src={url} alt="" data-testid="self-portrait-image" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }

  return (
    <div
      data-testid="self-portrait-none"
      style={{
        ...boxStyle,
        background: "rgba(20,12,6,.4)",
        border: "1px dashed rgba(109,90,56,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 10, lineHeight: 1.3, color: "var(--ink-faint)", padding: "0 4px" }}>
        no likeness yet
      </span>
    </div>
  );
}

export function SelfPanel({ connection, campaignId, sheet }: SelfPanelProps) {
  const currency = sheet.currency ?? ZERO_CURRENCY;
  const conditions = sheet.conditions ?? [];
  const inventory = sheet.inventory ?? [];
  const spellSlotEntries = Object.entries(sheet.spellSlots ?? {}).filter(([, slot]) => typeof slot?.total === "number" && slot.total > 0);
  const abilityScores = sheet.abilityScores;

  return (
    <div>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <Portrait connection={connection} campaignId={campaignId} filename={sheet.portraitImage} />
        <div style={{ minWidth: 0 }}>
          <div data-testid="self-name" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 21, letterSpacing: 0.6, color: "var(--ink)" }}>
            {sheet.name}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-dim)" }}>
            {sheet.race} {sheet.class} · Level {sheet.level}
          </div>
          {typeof sheet.xp === "number" && (
            <div data-testid="self-xp" style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 8 }}>
              {sheet.xp.toLocaleString()} xp
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {sheet.hp && (
          <StatBox label="VITALITY" value={`${sheet.hp.current}/${sheet.hp.max}`} color="var(--ember)" />
        )}
        {typeof sheet.armorClass === "number" && <StatBox label="ARMOUR" value={String(sheet.armorClass)} />}
      </div>

      {conditions.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--ink-faint)" }}>CONDITIONS</span>
          {conditions.map((c) => (
            <span
              key={c}
              data-testid="self-condition"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 12,
                color: "var(--ember)",
                background: "rgba(124,61,32,.28)",
                border: "1px solid rgba(211,112,60,.4)",
                padding: "3px 10px",
                borderRadius: 20,
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}

      {abilityScores && (
        <>
          <div style={{ marginTop: 18, fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--brass-dim)" }}>ABILITIES</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7, marginTop: 8 }}>
            {ABILITIES.filter((a) => typeof abilityScores[a.key] === "number").map((a) => {
              const score = abilityScores[a.key] as number;
              return (
                <div key={a.key} style={{ textAlign: "center", padding: "9px 4px", borderRadius: 4, background: "rgba(20,12,6,.3)", border: "1px solid rgba(109,90,56,.25)" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: 1, color: "var(--ink-faint)" }}>{a.label}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, color: "var(--ink)", lineHeight: 1.1 }}>{score}</div>
                  <div style={{ fontSize: 11, color: "var(--arcane)" }}>{modifier(score)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {spellSlotEntries.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {spellSlotEntries.map(([level, slot]) => {
            const used = Math.min(Math.max(slot.used ?? 0, 0), slot.total);
            return (
              <div key={level} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }} data-testid="self-spell-slot-row">
                <span style={{ fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--brass-dim)" }}>
                  SPELL SLOTS · {level.toUpperCase()}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {Array.from({ length: slot.total }, (_, i) => (
                    <span
                      key={i}
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        border: "1.5px solid var(--arcane)",
                        background: i < slot.total - used ? "var(--arcane)" : "transparent",
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 18, fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--brass-dim)" }}>PURSE</div>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        {COIN_ORDER.map((coin) => (
          <div key={coin.key} data-testid={`self-coin-${coin.key}`} style={{ textAlign: "center" }}>
            <div style={{ width: 26, height: 26, margin: "0 auto", borderRadius: "50%", background: `var(--coin-${coin.key})`, boxShadow: "inset 0 -2px 3px rgba(0,0,0,.4), inset 0 2px 2px rgba(255,255,255,.25)" }} />
            <div style={{ fontFamily: "var(--font-display)", fontSize: 12, color: "var(--ink)", marginTop: 4 }}>{currency[coin.key]}</div>
            <div style={{ fontSize: 9, color: "var(--ink-faint)", letterSpacing: 1 }}>{coin.label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, fontFamily: "var(--font-display)", fontSize: 10, letterSpacing: 1.5, color: "var(--brass-dim)" }}>CARRIED</div>
      <div style={{ marginTop: 6 }}>
        {inventory.length === 0 && (
          <p style={{ fontStyle: "italic", fontSize: 13, color: "var(--ink-faint)" }}>Carrying nothing yet.</p>
        )}
        {inventory.map((entry, i) => (
          <div
            key={`${entry.item}-${i}`}
            data-testid="self-inventory-item"
            style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(109,90,56,.2)" }}
          >
            <span style={{ fontSize: 14, color: "var(--ink)" }}>{entry.item}</span>
            {entry.quantity > 1 && <span style={{ fontSize: 11.5, color: "var(--ink-faint)", fontStyle: "italic" }}>×{entry.quantity}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
