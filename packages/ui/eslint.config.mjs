// @ts-check
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const baseConfig = require("@cronium/eslint-config");

export default [
  ...baseConfig,
  {
    ignores: ["dist/**", "tsup.config.ts", "tailwind.config.ts"],
  },
];
