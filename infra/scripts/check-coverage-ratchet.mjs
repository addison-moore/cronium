#!/usr/bin/env node
/**
 * Coverage ratchet: fails CI when total statement/branch coverage of
 * apps/cronium-app drops more than TOLERANCE points below the committed
 * baseline. There is no absolute threshold — the bar is "never regress".
 *
 * Usage: node infra/scripts/check-coverage-ratchet.mjs
 *   (after `pnpm test -- --coverage` has written coverage-summary.json)
 *
 * When coverage improves past the baseline, raise the baseline in
 * infra/scripts/coverage-baseline.json in the same PR so the gain is locked in.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TOLERANCE = 0.5; // percentage points

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const baselinePath = path.join(here, "coverage-baseline.json");
const summaryPath = path.join(
  repoRoot,
  "apps/cronium-app/coverage/coverage-summary.json",
);

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

let summary;
try {
  summary = JSON.parse(readFileSync(summaryPath, "utf8"));
} catch {
  console.error(
    `coverage ratchet: missing ${path.relative(repoRoot, summaryPath)} — ` +
      "run the jest suite with --coverage first.",
  );
  process.exit(1);
}

const total = summary.total;
let failed = false;

for (const metric of Object.keys(baseline.croniumApp)) {
  const base = baseline.croniumApp[metric];
  const actual = total[metric]?.pct;
  if (typeof actual !== "number") {
    console.error(`coverage ratchet: metric "${metric}" missing from summary`);
    failed = true;
    continue;
  }
  const delta = (actual - base).toFixed(2);
  if (actual < base - TOLERANCE) {
    console.error(
      `FAIL ${metric}: ${actual}% is below baseline ${base}% (Δ ${delta}, tolerance ${TOLERANCE})`,
    );
    failed = true;
  } else if (actual > base + TOLERANCE) {
    console.log(
      `NOTE ${metric}: ${actual}% beats baseline ${base}% (Δ +${delta}) — ` +
        "raise infra/scripts/coverage-baseline.json to lock in the gain.",
    );
  } else {
    console.log(`OK   ${metric}: ${actual}% (baseline ${base}%)`);
  }
}

process.exit(failed ? 1 : 0);
