import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  scaffoldCampaign,
  PROVIDERS,
  DEFAULT_PROVIDER,
  isValidProviderId,
  isModelValidForProvider,
  defaultModelForProvider,
  modelsForProvider,
  readCampaignProvider,
  persistCampaignProvider,
  readCampaignSettings,
  persistCampaignSettings,
} from "../src/campaign-store.js";

// ADR-0018: provider selection + persistence, mirroring the model helpers.

function uniqueId(): string {
  return `zz-provider-test-${process.pid}-${process.hrtime.bigint()}`;
}

test("isValidProviderId accepts claude/grok and rejects others", () => {
  assert.ok(isValidProviderId("claude"));
  assert.ok(isValidProviderId("grok"));
  assert.equal(isValidProviderId("openai"), false);
  assert.equal(isValidProviderId(""), false);
});

test("each provider's models cross-validate only against their own provider", () => {
  assert.ok(isModelValidForProvider("claude", "claude-sonnet-5"));
  assert.ok(isModelValidForProvider("grok", "grok-build"));
  // A model from the other provider is rejected — the guard the routes rely on.
  assert.equal(isModelValidForProvider("grok", "claude-sonnet-5"), false);
  assert.equal(isModelValidForProvider("claude", "grok-build"), false);
});

test("defaultModelForProvider returns a model that belongs to that provider", () => {
  for (const p of PROVIDERS) {
    const dflt = defaultModelForProvider(p.id);
    assert.ok(isModelValidForProvider(p.id, dflt), `${dflt} should be a ${p.id} model`);
    assert.ok(modelsForProvider(p.id).length > 0);
  }
});

test("readCampaignProvider defaults to Claude with no stored value (backward compatible)", () => {
  const id = uniqueId();
  const dir = scaffoldCampaign(id, { name: "Prov", race: "Human", class: "Fighter", level: 1 });
  try {
    assert.equal(readCampaignProvider(dir), DEFAULT_PROVIDER);
    assert.equal(readCampaignProvider(dir), "claude");
    assert.equal(readCampaignSettings(dir).provider, "claude");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("persistCampaignProvider round-trips and does not wipe other settings", () => {
  const id = uniqueId();
  const dir = scaffoldCampaign(id, { name: "Prov", race: "Elf", class: "Wizard", level: 1 });
  try {
    persistCampaignSettings(dir, { worldSetting: "a brass city", generateImages: true });
    persistCampaignProvider(dir, "grok");
    assert.equal(readCampaignProvider(dir), "grok");
    // The unrelated settings survive the provider write (merge, not overwrite).
    const s = readCampaignSettings(dir);
    assert.equal(s.provider, "grok");
    assert.equal(s.worldSetting, "a brass city");
    assert.equal(s.generateImages, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
