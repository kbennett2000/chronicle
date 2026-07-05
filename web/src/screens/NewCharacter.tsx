import { useMemo, useState } from "react";
import type { Connection } from "../lib/connection";
import { createCampaign, startSession, type CharacterCreationInput } from "../lib/campaign";

interface NewCharacterProps {
  connection: Connection;
  onCreated: (campaignId: string) => void;
  onCancel: () => void;
}

// Client copy of the server's char-gen data (src/character-gen.ts). The server
// is authoritative on submit; these drive the live preview only.
const RACES = ["Human", "Elf", "Dwarf", "Halfling", "Dragonborn", "Gnome", "Half-Elf", "Half-Orc", "Tiefling", "Orc", "Aasimar", "Goliath"];
const CLASS_HIT_DICE: Record<string, number> = {
  Barbarian: 12, Fighter: 10, Paladin: 10, Ranger: 10,
  Bard: 8, Cleric: 8, Druid: 8, Monk: 8, Rogue: 8, Warlock: 8,
  Sorcerer: 6, Wizard: 6,
};
const CLASSES = Object.keys(CLASS_HIT_DICE);

type Ability = "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";
const ABILITIES: Array<{ key: Ability; label: string }> = [
  { key: "strength", label: "STR" },
  { key: "dexterity", label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom", label: "WIS" },
  { key: "charisma", label: "CHA" },
];

// Standard 5e point-buy: 27 points, scores 8–15.
const POINT_BUY_BUDGET = 27;
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const MIN_SCORE = 8;
const MAX_SCORE = 15;

const modifier = (score: number) => Math.floor((score - 10) / 2);
const fmtMod = (m: number) => (m >= 0 ? `+${m}` : `${m}`);

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  background: "rgba(12,8,5,.5)",
  border: "1px solid rgba(109,90,56,.4)",
  borderRadius: 4,
  padding: "10px 13px",
  color: "var(--ink)",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  outline: "none",
};

const labelStyle = { fontSize: 11, color: "var(--ink-dim)", margin: "16px 0 4px", letterSpacing: 0.5 } as const;

export function NewCharacter({ connection, onCreated, onCancel }: NewCharacterProps) {
  const [name, setName] = useState("");
  const [race, setRace] = useState(RACES[0]);
  const [klass, setKlass] = useState("Rogue");
  const [scores, setScores] = useState<Record<Ability, number>>({
    strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8,
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spent = useMemo(() => ABILITIES.reduce((sum, a) => sum + POINT_COST[scores[a.key]], 0), [scores]);
  const remaining = POINT_BUY_BUDGET - spent;

  function adjust(ability: Ability, delta: number) {
    setScores((prev) => {
      const next = prev[ability] + delta;
      if (next < MIN_SCORE || next > MAX_SCORE) return prev;
      const wouldSpend = spent - POINT_COST[prev[ability]] + POINT_COST[next];
      if (wouldSpend > POINT_BUY_BUDGET) return prev;
      return { ...prev, [ability]: next };
    });
  }

  const maxHp = Math.max(1, CLASS_HIT_DICE[klass] + modifier(scores.constitution));
  const armorClass = 10 + modifier(scores.dexterity);
  const canCreate = name.trim().length > 0 && remaining >= 0 && !creating;

  async function submit() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    const character: CharacterCreationInput = { name: name.trim(), race, class: klass, abilityScores: scores };
    try {
      const campaignId = await createCampaign(connection, character);
      await startSession(connection, campaignId);
      onCreated(campaignId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  return (
    <div className="screen leather-ground">
      <div
        style={{
          flexShrink: 0,
          padding: "54px 16px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid rgba(109,90,56,.3)",
        }}
      >
        <button className="icon-button" data-testid="newchar-back" onClick={onCancel}>
          <span className="back-chevron" />
        </button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: 2, color: "var(--ink)" }}>
          NEW CHRONICLE
        </div>
      </div>

      <div className="cx-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 18px 40px" }}>
        <div style={labelStyle}>Name</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Kira Emberfall"
          data-testid="newchar-name"
          style={inputStyle}
        />

        <div style={labelStyle}>Ancestry</div>
        <select value={race} onChange={(e) => setRace(e.target.value)} data-testid="newchar-race" style={inputStyle}>
          {RACES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        <div style={labelStyle}>Calling</div>
        <select value={klass} onChange={(e) => setKlass(e.target.value)} data-testid="newchar-class" style={inputStyle}>
          {CLASSES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 0 6px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 2, color: "var(--brass)" }}>ABILITIES</div>
          <div data-testid="newchar-points" style={{ fontSize: 11.5, color: remaining === 0 ? "var(--ink-faint)" : "var(--ember)" }}>
            {remaining} points to spend
          </div>
        </div>

        {ABILITIES.map(({ key, label }) => (
          <div
            key={key}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid rgba(109,90,56,.18)" }}
          >
            <div style={{ width: 34, fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 1, color: "var(--ink-dim)" }}>{label}</div>
            <button
              onClick={() => adjust(key, -1)}
              data-testid={`newchar-${key}-dec`}
              disabled={scores[key] <= MIN_SCORE}
              style={stepStyle(scores[key] <= MIN_SCORE)}
            >
              −
            </button>
            <div data-testid={`newchar-${key}-score`} style={{ width: 22, textAlign: "center", fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink)" }}>
              {scores[key]}
            </div>
            <button
              onClick={() => adjust(key, 1)}
              data-testid={`newchar-${key}-inc`}
              disabled={scores[key] >= MAX_SCORE || POINT_COST[scores[key] + 1] - POINT_COST[scores[key]] > remaining}
              style={stepStyle(scores[key] >= MAX_SCORE || POINT_COST[scores[key] + 1] - POINT_COST[scores[key]] > remaining)}
            >
              +
            </button>
            <div style={{ width: 34, textAlign: "right", fontSize: 12, color: "var(--arcane)" }}>{fmtMod(modifier(scores[key]))}</div>
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <div style={derivedTileStyle}>
            <div style={derivedNumStyle} data-testid="newchar-hp">{maxHp}</div>
            <div style={derivedLabelStyle}>VITALITY</div>
          </div>
          <div style={derivedTileStyle}>
            <div style={derivedNumStyle} data-testid="newchar-ac">{armorClass}</div>
            <div style={derivedLabelStyle}>ARMOUR</div>
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--ink-faint)", fontStyle: "italic", marginTop: 8, lineHeight: 1.4 }}>
          Starting at level 1. HP and armour are derived from your class and scores; gear is
          established as your tale opens.
        </div>

        <button
          onClick={submit}
          disabled={!canCreate}
          data-testid="newchar-create"
          style={{
            marginTop: 22,
            width: "100%",
            cursor: canCreate ? "pointer" : "default",
            opacity: canCreate ? 1 : 0.55,
            padding: 13,
            borderRadius: 3,
            background: "linear-gradient(180deg,#d8743e,#a8511f)",
            border: "none",
            color: "#faf0e2",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 2,
          }}
        >
          {creating ? "BEGINNING…" : "BEGIN THE TALE"}
        </button>
        {error && (
          <div data-testid="newchar-error" style={{ marginTop: 10, fontSize: 12, color: "var(--ember)", textAlign: "center" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function stepStyle(disabled: boolean) {
  return {
    width: 30,
    height: 30,
    borderRadius: "50%",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    background: "rgba(28,20,12,.6)",
    border: "1px solid var(--brass-dim)",
    color: "var(--ink)",
    fontSize: 18,
    lineHeight: 1,
  } as const;
}

const derivedTileStyle = {
  flex: 1,
  textAlign: "center" as const,
  padding: "12px 0",
  borderRadius: 4,
  background: "rgba(28,20,12,.5)",
  border: "1px solid rgba(109,90,56,.32)",
};
const derivedNumStyle = { fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ember)" } as const;
const derivedLabelStyle = { fontFamily: "var(--font-display)", fontSize: 9, letterSpacing: 1.5, color: "var(--ink-faint)", marginTop: 2 } as const;
