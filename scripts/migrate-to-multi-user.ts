/** One-time migration to multi-user layout (ADR-0019 / issue #83).
 *
 * Before: campaigns lived flat at `campaigns/<id>/`.
 * After:  campaigns nest under a user at `campaigns/<userId>/<id>/`.
 *
 * This script:
 *   1. Creates a bootstrap user from `.env` (BOOTSTRAP_USERNAME, default
 *      "kris"; BOOTSTRAP_PASSWORD required) if it doesn't exist yet.
 *   2. Moves every existing flat campaign under that user's dir. The tracked
 *      `test-campaign` fixture is moved with `git mv` to preserve history;
 *      real (gitignored) campaigns are moved with a plain rename.
 *
 * It is idempotent: re-running after everything is migrated does nothing.
 *
 * Safety (CLAUDE.md test-data hygiene): it refuses to run if the tracked
 * `test-campaign` has uncommitted changes — Kris may be live-playing it, and a
 * move should never carry or clobber a dirty fixture. Commit or settle it first.
 *
 * Usage:  npm run migrate:multi-user
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CAMPAIGNS_ROOT, userCampaignsRoot } from "../src/campaign-store.js";
import { createUser, userExists, userIdForUsername } from "../src/user-store.js";

const TEST_FIXTURE = "test-campaign";

function isCampaignDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, "character-sheet.json"));
}

/** Flat campaign dirs directly under CAMPAIGNS_ROOT (the pre-migration shape).
 * A user dir holds campaign subdirs, not a character-sheet.json of its own, so
 * this naturally skips already-migrated user dirs and the `_registry` helper. */
function findFlatCampaigns(): string[] {
  if (!fs.existsSync(CAMPAIGNS_ROOT)) return [];
  return fs
    .readdirSync(CAMPAIGNS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_registry")
    .map((e) => e.name)
    .filter((name) => isCampaignDir(path.join(CAMPAIGNS_ROOT, name)));
}

function gitStatusPorcelain(relPath: string): string {
  try {
    return execFileSync("git", ["status", "--porcelain", "--", relPath], {
      cwd: path.resolve(CAMPAIGNS_ROOT, ".."),
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function main(): void {
  const username = process.env.BOOTSTRAP_USERNAME ?? "kris";
  const password = process.env.BOOTSTRAP_PASSWORD;
  const userId = userIdForUsername(username);

  const flat = findFlatCampaigns();
  if (flat.length === 0) {
    console.log("Nothing to migrate — no flat campaigns under campaigns/. Already multi-user.");
    // Still ensure the bootstrap user exists so login works post-migration.
  }

  // Safety: never move a dirty tracked fixture.
  if (flat.includes(TEST_FIXTURE)) {
    const dirty = gitStatusPorcelain(`campaigns/${TEST_FIXTURE}`);
    if (dirty) {
      console.error(
        `Refusing to migrate: campaigns/${TEST_FIXTURE} has uncommitted changes:\n${dirty}\n` +
          `Commit or revert it first (Kris may be mid-session), then re-run.`
      );
      process.exit(1);
    }
  }

  // 1. Bootstrap user.
  if (!userExists(userId)) {
    if (!password || password.length < 6) {
      console.error(
        `BOOTSTRAP_PASSWORD is not set (or too short) in .env — needed to create the ` +
          `bootstrap user "${username}" that will own the existing campaigns. ` +
          `Set it and re-run.`
      );
      process.exit(1);
    }
    createUser(username, password);
    console.log(`Created bootstrap user "${username}" (id: ${userId}).`);
  } else {
    console.log(`Bootstrap user "${username}" (id: ${userId}) already exists.`);
  }

  const targetRoot = userCampaignsRoot(userId);
  fs.mkdirSync(targetRoot, { recursive: true });

  // 2. Move each flat campaign under the user dir.
  for (const name of flat) {
    const from = path.join(CAMPAIGNS_ROOT, name);
    const to = path.join(targetRoot, name);
    if (fs.existsSync(to)) {
      console.warn(`Skipping ${name}: ${path.relative(CAMPAIGNS_ROOT, to)} already exists.`);
      continue;
    }
    if (name === TEST_FIXTURE) {
      // Tracked fixture — preserve history.
      execFileSync("git", ["mv", `campaigns/${name}`, `campaigns/${userId}/${name}`], {
        cwd: path.resolve(CAMPAIGNS_ROOT, ".."),
        stdio: "inherit",
      });
      console.log(`git mv campaigns/${name} -> campaigns/${userId}/${name}`);
    } else {
      fs.renameSync(from, to);
      console.log(`moved campaigns/${name} -> campaigns/${userId}/${name}`);
    }
  }

  console.log(
    `\nDone. Existing campaigns now belong to "${username}". ` +
      `Update .gitignore's test-campaign allowlist to the nested path if not already done.`
  );
}

main();
