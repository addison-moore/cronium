import { createRequire } from "module";
const require = createRequire(import.meta.url);

const nextConfig = require("@cronium/eslint-config/next.mjs");

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...nextConfig,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];