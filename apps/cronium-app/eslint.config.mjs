// @ts-check
import eslintConfig from "@cronium/eslint-config/next.mjs";

export default [
  ...eslintConfig,
  {
    ignores: [
      "**/deprecated/**",
      "**/_backup/**",
      "**/*.backup.ts",
      "**/*.backup.tsx",
      "_scratch/**",
      "_backups/**",
      "scripts/**",
      "src/scripts/deprecated/**",
      "src/scripts/migrations/**",
      // Jest tests are excluded from the TS project (tsconfig excludes
      // __tests__); jest runs them, so skip typed-linting here.
      "**/__tests__/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      // Root-level files. `next lint` (removed in Next 16) only ever linted
      // src/app/components/lib, so these have never been linted; `eslint .`
      // reaches them. Keeping the gate identical to pre-upgrade rather than
      // folding a backlog into a framework bump — tailwind.config.ts and
      // instrumentation.ts additionally aren't in the tsconfig project, so
      // typed linting can't parse them at all. Tracked for a follow-up.
      "tailwind.config.ts",
      "instrumentation.ts",
      "drizzle.config.ts",
      "server.ts",
    ],
  },
];
