/** One-off migration for the "Gold pieces" inventory item -> currency
 * schema change (see docs/adr for context). Run once per campaign:
 *   npx tsx scripts/migrate-currency.ts <campaign-id>
 *
 * Replaces the flat "Gold pieces" inventory line with a `currency` object
 * ({ cp, sp, ep, gp, pp }), defaulting the existing gold count into `gp`.
 * Safe to re-run: a sheet that already has `currency` is left untouched.
 */
import fs from "node:fs";
import path from "node:path";
import { CAMPAIGNS_ROOT } from "../src/campaign-store.js";

const campaignId = process.argv[2];
if (!campaignId) {
  console.error("usage: tsx scripts/migrate-currency.ts <campaign-id>");
  process.exit(1);
}

const sheetPath = path.join(CAMPAIGNS_ROOT, campaignId, "character-sheet.json");
const sheet = JSON.parse(fs.readFileSync(sheetPath, "utf8"));

if (sheet.currency) {
  console.log(`${campaignId}: already migrated, skipping`);
  process.exit(0);
}

const inventory = Array.isArray(sheet.inventory) ? sheet.inventory : [];
const goldIndex = inventory.findIndex(
  (item: { item?: string }) => item.item === "Gold pieces"
);
const goldQuantity = goldIndex === -1 ? 0 : inventory[goldIndex].quantity ?? 0;

sheet.currency = { cp: 0, sp: 0, ep: 0, gp: goldQuantity, pp: 0 };
if (goldIndex !== -1) inventory.splice(goldIndex, 1);
sheet.inventory = inventory;

fs.writeFileSync(sheetPath, JSON.stringify(sheet, null, 2) + "\n");
console.log(`${campaignId}: migrated, gp=${goldQuantity}`);
