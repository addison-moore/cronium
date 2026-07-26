# Cronium Cross-Cutting Test Suites

This directory holds test suites that span packages and don't belong to a
single workspace package. Fast, hermetic unit tests do **not** live here —
they are co-located in `apps/cronium-app/src/**/__tests__/` and run with
`pnpm test` (which CI runs on every push/PR with coverage; see
`infra/scripts/check-coverage-ratchet.mjs` for the regression gate).

## Layout

| Path                | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                              | Runs in CI?                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `security/`         | Hermetic security regression suite (no DB, no Valkey, no network). Includes `route-capability-inventory.test.ts`, a static gate that scans tRPC router source and fails on any mutation missing from `ROUTE_CAPABILITIES`. The jest project also pulls in ~30 co-located security tests from `apps/cronium-app/src` so they all run under one banner.                                                                                                   | Yes — `pnpm test:security` on every push/PR (`ci.yml`). |
| `storage/`          | Storage-layer suites against a REAL disposable Postgres (FK-ordered deletes, concurrent job claiming, CAS transitions, workflow persistence). `setup.ts` refuses to run unless `DATABASE_URL` is a loopback throwaway instance, so it can never touch the shared dev DB. Launched by `pnpm test:storage`, which boots the container, pushes the schema, runs the suites, and tears down.                                                                | Yes — the `storage` job in `ci.yml` (ubuntu-latest).    |
| `e2e/`              | End-to-end pipeline suites against the FULL disposable stack (app + worker + socket on the host; Postgres/Valkey/orchestrator with real Docker job containers + runtime sidecars in containers). Drives only the real wire surface (bearer-token tRPC + SQL). `setup.ts` refuses non-loopback `DATABASE_URL`s. Launched by `pnpm test:e2e` (`infra/scripts/run-e2e-tests.sh`); `E2E_KEEP_STACK=1` keeps the stack up for debugging/manual perf probing. | Yes — the `e2e` job in `ci.yml` (ubuntu-latest).        |
| `attic/`            | Retired suites that predate the scheduling overhaul and no longer compile or match current APIs. Not run anywhere (`.attic` suffix). See `attic/README.md` for what supersedes each.                                                                                                                                                                                                                                                                    | No.                                                     |
| `superjson-stub.ts` | Passthrough stub for the ESM-only `superjson` package, used by the jest config here.                                                                                                                                                                                                                                                                                                                                                                    | —                                                       |

## Running

```bash
# Everything wired into this config (currently: Security Tests)
pnpm test:integration

# Security suite exactly as CI runs it
pnpm test:security

# Single file
pnpm test:integration -- tests/security/security-validation.test.ts

# Storage suite against a real disposable Postgres (needs Docker). Boots and
# tears down its own throwaway Postgres + Valkey — never touches the dev DB.
pnpm test:storage
# Pass jest flags through, e.g. one file:
pnpm test:storage -- tests/storage/fk-deletes.test.ts
```

```bash
# Full end-to-end pipeline (needs Docker; builds images + the app on first run).
pnpm test:e2e
# Keep the stack alive after the run for debugging / manual perf probing:
E2E_KEEP_STACK=1 pnpm test:e2e
```

The `security`/`integration` suites are hermetic (no services). `test:storage`
and `test:e2e` are the exceptions: they need Docker and manage their own
disposable services end to end.

## Conventions

- New unit tests go co-located in the owning package, not here.
- A suite added to this directory must either run in CI or ship with a
  documented manual runbook in this README — nothing lands here "to run later".
- Retired suites move to `attic/` with a note in `attic/README.md`, and are
  deleted once a replacement lands.
