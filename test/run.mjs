/**
 * Test runner. There is no test framework dependency: esbuild (already a build
 * dependency) bundles each test file, and node's built-in test runner executes
 * them.
 *
 * The suite runs three times, in three timezones. That is deliberate. The bug
 * this harness was written for (week and day keys built with toISOString on a
 * local-midnight date) is invisible at UTC and only appears east of it, which
 * is why it survived every type check and build for months.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const testDir = path.join(root, "test");
const outdir = path.join(root, ".test-build");

// Best-effort clean. esbuild overwrites anyway, and some sandboxes disallow
// unlink on the working tree, which must not fail the run.
try { rmSync(outdir, { recursive: true, force: true }); } catch { /* keep going */ }

const entryPoints = readdirSync(testDir)
  .filter(f => f.endsWith(".test.ts"))
  .map(f => path.join(testDir, f));

if (entryPoints.length === 0) {
  console.error("No test files found in test/.");
  process.exit(1);
}

await build({
  entryPoints,
  outdir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: "inline",
  logLevel: "warning",
  alias: { obsidian: path.join(testDir, "stubs", "obsidian.mjs") },
});

const ZONES = ["UTC", "Asia/Bangkok", "America/New_York"];
let failed = false;

// Pass built files explicitly: `node --test <dir>` resolves the directory as a
// module rather than scanning it.
const built = readdirSync(outdir)
  .filter(f => f.endsWith(".js"))
  .map(f => path.join(outdir, f));

for (const TZ of ZONES) {
  console.log(`\n──────── TZ=${TZ} ────────`);
  const res = spawnSync(process.execPath, ["--test", ...built], {
    stdio: "inherit",
    env: { ...process.env, TZ },
  });
  if (res.status !== 0) failed = true;
}

console.log(failed ? "\nFAILED" : `\nAll suites passed in ${ZONES.join(", ")}.`);
process.exit(failed ? 1 : 0);
