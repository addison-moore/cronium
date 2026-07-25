#!/usr/bin/env node
/**
 * Go coverage ratchet: fails CI when a Go module's total statement coverage
 * drops more than TOLERANCE points below the committed baseline (the `go`
 * section of coverage-baseline.json). Same contract as the TS ratchet
 * (check-coverage-ratchet.mjs): no absolute threshold, never regress, raise
 * the baseline in the same PR when coverage improves.
 *
 * Usage: node infra/scripts/check-go-coverage-ratchet.mjs
 *   (after each module's `go test -coverprofile=coverage.out ./...`)
 *
 * Parses the coverprofile directly — each line after `mode:` is
 * `file:startL.startC,endL.endC numStmts hitCount`; total statement coverage
 * is covered-statements / total-statements. NOTE: this can differ from the
 * total printed by `go tool cover -func` by a few tenths of a point (that
 * tool aggregates slightly differently); the ratchet is self-consistent —
 * baselines are in THIS script's units, so always update them from this
 * script's output, not from `go tool cover`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TOLERANCE = 0.5; // percentage points

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const baselinePath = path.join(here, "coverage-baseline.json");

const MODULES = {
  orchestrator: "apps/orchestrator/coverage.out",
  runtime: "apps/runtime/cronium-runtime/coverage.out",
  runner: "apps/runner/cronium-runner/coverage.out",
};

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
if (!baseline.go) {
  console.error("go coverage ratchet: no `go` section in coverage-baseline.json");
  process.exit(1);
}

function totalStatementCoverage(profilePath) {
  const text = readFileSync(profilePath, "utf8");
  // The same block can appear more than once in a merged profile (`go tool
  // cover` merges by block, summing counts) — dedupe by block key so
  // statements are counted once, like `go tool cover -func` does.
  const blocks = new Map(); // "file:range" -> { numStmts, hits }
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("mode:")) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const numStmts = Number(parts[1]);
    const hits = Number(parts[2]);
    if (!Number.isFinite(numStmts) || !Number.isFinite(hits)) continue;
    const prev = blocks.get(parts[0]);
    if (prev) prev.hits += hits;
    else blocks.set(parts[0], { numStmts, hits });
  }
  let total = 0;
  let covered = 0;
  for (const { numStmts, hits } of blocks.values()) {
    total += numStmts;
    if (hits > 0) covered += numStmts;
  }
  if (total === 0) return 0;
  return (covered / total) * 100;
}

let failed = false;

for (const [name, relPath] of Object.entries(MODULES)) {
  const base = baseline.go[name];
  if (typeof base !== "number") {
    console.error(`go coverage ratchet: module "${name}" missing from baseline`);
    failed = true;
    continue;
  }
  let actual;
  try {
    actual = totalStatementCoverage(path.join(repoRoot, relPath));
  } catch {
    console.error(
      `go coverage ratchet: missing ${relPath} — run that module's tests with -coverprofile first.`,
    );
    failed = true;
    continue;
  }
  const pct = Number(actual.toFixed(2));
  const delta = (pct - base).toFixed(2);
  if (pct < base - TOLERANCE) {
    console.error(
      `FAIL ${name}: ${pct}% is below baseline ${base}% (Δ ${delta}, tolerance ${TOLERANCE})`,
    );
    failed = true;
  } else if (pct > base + TOLERANCE) {
    console.log(
      `NOTE ${name}: ${pct}% beats baseline ${base}% (Δ +${delta}) — ` +
        "raise the go section of infra/scripts/coverage-baseline.json to lock in the gain.",
    );
  } else {
    console.log(`OK   ${name}: ${pct}% (baseline ${base}%)`);
  }
}

process.exit(failed ? 1 : 0);
