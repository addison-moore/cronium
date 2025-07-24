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
      "scripts/**",
      "src/scripts/deprecated/**",
      "src/scripts/migrations/archived/**",
    ],
  },
];
