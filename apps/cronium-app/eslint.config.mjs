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
    ],
  },
];
