const nextPlugin = require("@next/eslint-plugin-next");
const baseConfig = require("./index.js");

// @next/eslint-plugin-next 16 ships native flat configs (`recommended` /
// `core-web-vitals`); the legacy `plugin:@next/next/recommended` shape is only
// reachable through the `*-legacy` keys. Use the flat config directly instead
// of bridging the legacy one through FlatCompat.
module.exports = [
  ...baseConfig,
  nextPlugin.configs.recommended,
  {
    ignores: ["**/.next/", "**/out/"],
  },
];
