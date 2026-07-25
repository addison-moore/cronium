const path = require("node:path");

/** @type {import('jest').Config} */
const sharedProjectConfig = {
  rootDir: __dirname,
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/../apps/cronium-app/src/$1",
    "^@shared/(.*)$": "<rootDir>/../apps/cronium-app/src/shared/$1",
    "^@server/(.*)$": "<rootDir>/../apps/cronium-app/src/server/$1",
    "^@lib/(.*)$": "<rootDir>/../apps/cronium-app/src/lib/$1",
    // superjson ships ESM-only; ts-jest here has no JS transform for it.
    "^superjson$": "<rootDir>/superjson-stub.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        // Transpile only — no type diagnostics. This matches how the app's own
        // jest runs (next/jest uses SWC, which never type-checks), and keeps
        // ts-jest from failing suites on type quirks that only appear under its
        // partial tsconfig (e.g. discriminated-union narrowing in job-service.ts
        // without the app's full strict lib config). `pnpm typecheck` remains
        // the real type gate.
        isolatedModules: true,
        tsconfig: {
          target: "ES2022",
          module: "CommonJS",
          moduleResolution: "Node",
          jsx: "react-jsx",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          baseUrl: path.join(__dirname, "../apps/cronium-app"),
          paths: {
            "@/*": ["./src/*"],
            "@shared/*": ["./src/shared/*"],
            "@server/*": ["./src/server/*"],
            "@lib/*": ["./src/lib/*"],
            // Cross-cutting suites in tests/ import a few app deps directly
            // (drizzle-orm operators). Those live under the app's node_modules,
            // which TS's default resolution from tests/ won't find — map them
            // explicitly (baseUrl is apps/cronium-app).
            "drizzle-orm": ["./node_modules/drizzle-orm"],
            "drizzle-orm/*": ["./node_modules/drizzle-orm/*"],
          },
        },
      },
    ],
  },
};

// Cross-cutting suites that don't fit a single package. Fast, hermetic unit
// tests belong co-located in apps/cronium-app/src/**/__tests__ instead (run by
// `pnpm test`). Suites needing real services get their own project here (a
// "Storage Tests" project against a disposable Postgres is planned — see
// _plans/testing/PLAN.md). Retired suites live in tests/attic/, excluded from
// every testMatch via their .attic suffix.
module.exports = {
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["text", "lcov", "html"],
  coveragePathIgnorePatterns: ["/node_modules/", "/dist/", "/.next/"],
  projects: [
    {
      ...sharedProjectConfig,
      displayName: "Security Tests",
      roots: ["<rootDir>/security", "<rootDir>/../apps/cronium-app/src"],
      testMatch: [
        "<rootDir>/security/**/*.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/__tests__/api-token-hash.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/__tests__/socket-ticket.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/__tests__/socket-client-url.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/__tests__/ssrf-guard.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/__tests__/valkey-url.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/mcp-oauth/__tests__/tokens.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/mcp-oauth/__tests__/store-consume.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/oauth/__tests__/pkce.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/webhooks/__tests__/webhook-security.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/webhooks/__tests__/webhook-tenant-scope.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/webhooks/__tests__/webhook-secret.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/security/__tests__/credential-encryption.test.ts",
        "<rootDir>/../apps/cronium-app/src/server/__tests__/socket-security.test.ts",
        "<rootDir>/../apps/cronium-app/src/server/__tests__/socket-security-store.test.ts",
        "<rootDir>/../apps/cronium-app/src/server/__tests__/startup-security.test.ts",
        "<rootDir>/../apps/cronium-app/src/server/__tests__/terminal-websocket-security.test.ts",
        "<rootDir>/../apps/cronium-app/src/server/__tests__/token-scopes.test.ts",
        "<rootDir>/../apps/cronium-app/src/server/security/__tests__/resource-access.test.ts",
        "<rootDir>/../apps/cronium-app/src/server/security/__tests__/authorization.test.ts",
        "<rootDir>/../apps/cronium-app/src/server/api/__tests__/trpc-authorization.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/security/__tests__/client-ip.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/security/__tests__/security-headers.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/security/__tests__/totp.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/security/__tests__/mfa-recovery.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/security/__tests__/secret-vault.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/security/__tests__/variable-secret.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/security/__tests__/field-secret.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/security/__tests__/job-capability.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/security/__tests__/execution-token-revocation.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/tools/__tests__/redact.test.ts",
        "<rootDir>/../apps/cronium-app/src/lib/tools/__tests__/redact-canary.test.ts",
      ],
      setupFiles: ["<rootDir>/security/setup.ts"],
      testTimeout: 60_000,
    },
    {
      // Storage-layer suites against a DISPOSABLE local Postgres (+ Valkey),
      // launched by infra/scripts/run-storage-tests.sh / `pnpm test:storage`.
      // setup.ts refuses to run unless DATABASE_URL is a loopback throwaway
      // instance, so this project never touches the shared dev database.
      ...sharedProjectConfig,
      displayName: "Storage Tests",
      // Stub the two ESM-only specifiers ts-jest can't transform (env.mjs pulls
      // in @t3-oss/env-nextjs; nanoid v5 is pure ESM). These MUST precede the
      // generic "^@/(.*)$" mapping, so they're listed before the spread.
      // env.mjs is imported both aliased (`@/env.mjs`, from db.ts) and relative
      // (`../env.mjs`, from encryption-service.ts), so match any specifier
      // ending in `/env.mjs` — otherwise the relative import slips through to
      // the real ESM file and crashes ts-jest.
      moduleNameMapper: {
        "(?:^@/|/)env\\.mjs$": "<rootDir>/storage/helpers/env-stub.ts",
        "^nanoid$": "<rootDir>/storage/helpers/nanoid-stub.ts",
        ...sharedProjectConfig.moduleNameMapper,
      },
      roots: ["<rootDir>/storage"],
      testMatch: ["<rootDir>/storage/**/*.test.ts"],
      // The suites live in tests/ but import app deps (drizzle-orm, pg, …) that
      // pnpm installs under the app's own node_modules — add it to the
      // resolution roots so those bare specifiers resolve.
      moduleDirectories: [
        "node_modules",
        path.join(__dirname, "../apps/cronium-app/node_modules"),
      ],
      setupFiles: ["<rootDir>/storage/setup.ts"],
      // Real container boot + schema churn: generous ceiling.
      testTimeout: 120_000,
    },
    {
      // End-to-end pipeline suites against the full disposable stack
      // (app + worker + socket on the host, orchestrator/Postgres/Valkey in
      // Docker), launched by infra/scripts/run-e2e-tests.sh / `pnpm test:e2e`.
      // Deliberately import-free of app source: raw SQL (pg) + fetch only, so
      // no env.mjs/nanoid stubs are needed. setup.ts refuses non-loopback
      // DATABASE_URLs so this can never touch the shared dev database.
      ...sharedProjectConfig,
      displayName: "E2E Tests",
      roots: ["<rootDir>/e2e"],
      testMatch: ["<rootDir>/e2e/**/*.test.ts"],
      // `pg` lives under the app's node_modules.
      moduleDirectories: [
        "node_modules",
        path.join(__dirname, "../apps/cronium-app/node_modules"),
      ],
      setupFilesAfterEnv: ["<rootDir>/e2e/setup.ts"],
      // Real scheduler ticks + container execution; per-test ceiling is set in
      // e2e/setup.ts (jest.setTimeout).
      testTimeout: 240_000,
    },
  ],
};
