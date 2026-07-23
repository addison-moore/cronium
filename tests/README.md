# Cronium Cross-Cutting Test Suites

This directory holds test suites that span packages and don't belong to a
single workspace package. Fast, hermetic unit tests do **not** live here —
they are co-located in `apps/cronium-app/src/**/__tests__/` and run with
`pnpm test` (which CI runs on every push/PR with coverage; see
`infra/scripts/check-coverage-ratchet.mjs` for the regression gate).

## Layout

| Path                | What it is                                                                                                                                                                                                                                                                                                                                            | Runs in CI?                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `security/`         | Hermetic security regression suite (no DB, no Valkey, no network). Includes `route-capability-inventory.test.ts`, a static gate that scans tRPC router source and fails on any mutation missing from `ROUTE_CAPABILITIES`. The jest project also pulls in ~30 co-located security tests from `apps/cronium-app/src` so they all run under one banner. | Yes — `pnpm test:security` on every push/PR (`ci.yml`). |
| `attic/`            | Retired suites that predate the scheduling overhaul and no longer compile or match current APIs. Not run anywhere (`.attic` suffix). See `attic/README.md` for what supersedes each.                                                                                                                                                                  | No.                                                     |
| `superjson-stub.ts` | Passthrough stub for the ESM-only `superjson` package, used by the jest config here.                                                                                                                                                                                                                                                                  | —                                                       |

## Running

```bash
# Everything wired into this config (currently: Security Tests)
pnpm test:integration

# Security suite exactly as CI runs it
pnpm test:security

# Single file
pnpm test:integration -- tests/security/security-validation.test.ts
```

No services are required — every suite in this config is hermetic by design.
Suites that need real infrastructure (Postgres-backed storage tests, the
end-to-end job pipeline) are planned as separate projects here; see
`_plans/testing/PLAN.md` (Phases 3 and 5) for what's coming and what each phase
replaces.

## Conventions

- New unit tests go co-located in the owning package, not here.
- A suite added to this directory must either run in CI or ship with a
  documented manual runbook in this README — nothing lands here "to run later".
- Retired suites move to `attic/` with a note in `attic/README.md`, and are
  deleted once a replacement lands.
