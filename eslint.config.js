const { fixupConfigRules, fixupPluginRules } = require("@eslint/compat");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const _import = require("eslint-plugin-import");
const prettier = require("eslint-plugin-prettier");
const prettierConfig = require("eslint-config-prettier");
const { FlatCompat } = require("@eslint/eslintrc");
const js = require("@eslint/js");
const typescriptEslintParser = require("@typescript-eslint/parser");
const path = require("node:path");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = [
  {
    ignores: [
      "**/node_modules/",
      "**/.next/",
      "**/out/",
      "**/dist/",
      "**/build/",
      "**/coverage/",
      "_scratch/*",
      "**/*.js",
      "**/deprecated/*",
      "scripts/*",
      "**/*.mjs",
      "**/*.cjs",
      "**/__tests__/*",
      "**/_backups/*",
      "docker/*",
      "plans/*",
      "package-lock.json",
      "pnpm-lock.yaml",
    ],
  },
  ...fixupConfigRules(
    compat.extends(
      "plugin:@next/next/recommended",
      "plugin:@typescript-eslint/recommended-type-checked",
      "plugin:@typescript-eslint/stylistic-type-checked",
    ),
  ),
  prettierConfig,

  {
    plugins: {
      "@typescript-eslint": fixupPluginRules(typescriptEslint),
      import: fixupPluginRules(_import),
      prettier: fixupPluginRules(prettier),
    },

    languageOptions: {
      parser: typescriptEslintParser,
      ecmaVersion: "latest",
      sourceType: "module",

      parserOptions: {
        project: true,
        tsconfigRootDir: __dirname,
      },
    },

    rules: {
      "prettier/prettier": "warn",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",

      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/require-await": "off",

      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],

      // Type Safety Enforcement Rules - Phase 1
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
          allowAny: false,
          allowNullish: false,
        },
      ],
    },
  },
];
