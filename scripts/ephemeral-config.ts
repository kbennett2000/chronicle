/** ADR-0033: the server reads its host/port (and other settings) from the repo-root
 * config.json, no longer from env. Dev harnesses that spawn a server on a random
 * ephemeral port therefore can't inject PORT/HOST via `env` anymore — they briefly
 * write a config.json instead. This helper writes one (deep-merged over the committed
 * config.example.json defaults) and returns a restore fn that puts back whatever was
 * there before, so a developer's real config.json survives a harness run. config.json
 * is git-ignored and not campaign data, and a live server holds its own frozen config
 * in memory, so the transient swap can't affect live play.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(REPO_ROOT, "config.json");
const EXAMPLE_PATH = path.join(REPO_ROOT, "config.example.json");

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (isPlainObject(value) && isPlainObject(existing)) deepMerge(existing, value);
    else target[key] = value;
  }
  return target;
}

/** Write a temporary repo-root config.json = config.example.json deep-merged with
 * `overrides`, and return a function that restores the prior state. */
export function withEphemeralConfig(overrides: Record<string, unknown>): () => void {
  const backup = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf8") : null;
  const base = JSON.parse(fs.readFileSync(EXAMPLE_PATH, "utf8")) as Record<string, unknown>;
  const merged = deepMerge(base, overrides);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n");
  return () => {
    if (backup !== null) fs.writeFileSync(CONFIG_PATH, backup);
    else fs.rmSync(CONFIG_PATH, { force: true });
  };
}
