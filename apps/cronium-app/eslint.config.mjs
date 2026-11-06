// @ts-check
import eslintConfig from "@cronium/eslint-config/next.mjs";

const LOG_A_FAILURE =
  "A caught error can be a failed query, and its message, fields and stack hold every value it was saving. Log describeFailure(error) or failureWithStack(error) from @/lib/pg-errors.";

export default [
  ...eslintConfig,
  {
    // tests/storage/query-failure-logging.test.ts shows what these print.
    files: ["src/app/api/**/*.ts", "src/server/api/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='console'] > Identifier[name=/^(e|err|error)$|Error$/]",
          message: LOG_A_FAILURE,
        },
        {
          selector:
            "CallExpression[callee.object.name='console'] MemberExpression[property.name=/^(message|stack)$/]:matches([object.name=/^(e|err|error)$|Error$/], [object.expression.name=/^(e|err|error)$|Error$/])",
          message: LOG_A_FAILURE,
        },
        {
          selector:
            "CallExpression[callee.property.name='catch'] > MemberExpression[object.name='console']",
          message: LOG_A_FAILURE,
        },
      ],
    },
  },
  {
    ignores: [
      "**/deprecated/**",
      "**/_backup/**",
      "**/*.backup.ts",
      "**/*.backup.tsx",
      "_scratch/**",
      "_backups/**",
      "scripts/**",
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
