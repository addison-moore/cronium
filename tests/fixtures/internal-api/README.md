# Internal API contract fixtures

Canonical response shapes for the 17 orchestrator-facing internal REST routes
under `apps/cronium-app/src/app/api/internal/**/route.ts`. These files are the
**source of truth** for the wire contract between the Next.js app and the Go
services (orchestrator, runtime, runner).

Consumers:

- TypeScript contract tests:
  `apps/cronium-app/src/app/api/internal/__tests__/internal-api-contract.*.test.ts`
  load each fixture and assert the route's real response deep-equals the pinned
  `status` + `body` (after sentinel substitution, see below).
- Go-side tests MUST consume these same JSON files (do not copy the shapes into
  Go literals) so both sides fail together when the contract drifts.

## File format

Each file covers one route (the `jobs/[jobId]/logs` and `variables` files cover
both methods of their route):

```json
{
  "route": "POST /api/internal/jobs/claim",
  "auth": "orchestrator-key | job-capability",
  "responses": {
    "<scenario-name>": { "status": 200, "body": { "...": "..." } }
  }
}
```

`responses` holds the canonical success shape plus the canonical error shapes
(401/400/403/404/409/413/500/503 as applicable to that route).

## Sentinel convention

Dynamic values are pinned by **sentinel placeholders** instead of literals. A
test (TS or Go) must replace the _actual_ value with the sentinel string before
deep-comparing, but only after validating the actual value satisfies the
sentinel's constraint:

| Sentinel     | Matches                                                           |
| ------------ | ----------------------------------------------------------------- |
| `<id>`       | any non-empty string identifier (job/user/execution/orchestrator) |
| `<iso-date>` | any string parseable as an ISO-8601 timestamp                     |
| `<token>`    | a per-job capability token (`cap.1.<payload>.<sig>`); this is the |
|              | bearer-style credential minted at claim time (the "`<jwt>`" slot) |
| `<number>`   | any finite JSON number                                            |

Everything that is NOT a sentinel is a literal and must match exactly —
including error message strings, booleans, and enum values (job statuses are
the lowercase `queued|claimed|running|completed|failed|timed_out|cancelled`).

Notes for implementers:

- Substitution is positional/structural: walk expected and actual together;
  where the expected node is a sentinel string, validate + replace the actual
  node. Keys present in the actual but absent from the fixture are a contract
  violation (deep equality must fail).
- Auth headers: `orchestrator-key` routes take `Authorization: Bearer
$CRONIUM_ORCHESTRATOR_KEY`; `job-capability` routes take the minted token in
  `X-Job-Capability`. Capability routes return 401 only for a _missing_ token;
  any invalid/expired/wrong-scope token is a uniform 403.
