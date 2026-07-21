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
          },
        },
      },
    ],
  },
};

module.exports = {
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["text", "lcov", "html"],
  coveragePathIgnorePatterns: ["/node_modules/", "/dist/", "/.next/"],
  projects: [
    {
      ...sharedProjectConfig,
      displayName: "Unit Tests",
      testMatch: ["<rootDir>/unit/**/*.test.ts"],
      setupFilesAfterEnv: ["<rootDir>/setup.ts"],
      testTimeout: 30_000,
    },
    {
      ...sharedProjectConfig,
      displayName: "Integration Tests",
      testMatch: ["<rootDir>/integration/**/*.test.ts"],
      setupFilesAfterEnv: ["<rootDir>/setup.ts"],
      testTimeout: 60_000,
    },
    {
      ...sharedProjectConfig,
      displayName: "Performance Tests",
      testMatch: ["<rootDir>/performance/**/*.test.ts"],
      setupFilesAfterEnv: ["<rootDir>/setup.ts"],
      testTimeout: 300_000,
    },
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
        "<rootDir>/../apps/cronium-app/src/lib/webhooks/__tests__/webhook-security.test.ts",
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
      ],
      setupFiles: ["<rootDir>/security/setup.ts"],
      testTimeout: 60_000,
    },
  ],
};
