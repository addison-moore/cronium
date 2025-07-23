const { fixupConfigRules } = require("@eslint/compat");
const { FlatCompat } = require("@eslint/eslintrc");
const js = require("@eslint/js");
const baseConfig = require("./index.js");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = [
  ...baseConfig,
  ...fixupConfigRules(compat.extends("plugin:@next/next/recommended")),
  {
    ignores: ["**/.next/", "**/out/"],
  },
];
