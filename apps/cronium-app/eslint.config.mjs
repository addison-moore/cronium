// @ts-check
import eslintConfig from "@cronium/eslint-config/next.mjs";

const LOG_A_FAILURE =
  "A caught error can be a failed query, and its message, fields and stack hold every value it was saving. Log describeFailure(error) or failureWithStack(error) from @/lib/pg-errors.";

/** What a caught error is usually called. */
const CAUGHT = "/^(e|ex|err|error)$|(Err|Error)$/";

export default [
  ...eslintConfig,
  {
    // tests/storage/query-failure-logging.test.ts shows what these print.
    files: [
      "server.ts",
      "worker.ts",
      "src/instrumentation.ts",
      "src/app/api/**/*.ts",
      "src/lib/**/*.ts",
      "src/scripts/**/*.ts",
      "src/server/**/*.ts",
      // Server code, in a tree that's mostly for the browser.
      "src/app/(auth)/auth/setup/actions.ts",
      "src/app/dashboard/(main)/events/page.tsx",
    ],
    ignores: [
      // The browser's console, not the server log. utils.ts also runs on the server,
      // but only ever logs a date it couldn't format.
      "src/lib/socket-ticket-client.ts",
      "src/lib/terminal-socket-manager.ts",
      "src/lib/utils.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `CallExpression[callee.object.name='console'] > Identifier[name=${CAUGHT}]`,
          message: LOG_A_FAILURE,
        },
        {
          selector: `CallExpression[callee.object.name='console'] MemberExpression[property.name=/^(message|stack|toString)$/]:matches([object.name=${CAUGHT}], [object.expression.name=${CAUGHT}])`,
          message: LOG_A_FAILURE,
        },
        {
          // `${error}`, String(error), JSON.stringify(error), `error.message : error`.
          selector: `CallExpression[callee.object.name='console'] :matches(TemplateLiteral, CallExpression[callee.name='String'], CallExpression[callee.property.name='stringify'], ConditionalExpression) > Identifier[name=${CAUGHT}]`,
          message: LOG_A_FAILURE,
        },
        {
          // { error } and { reason: error }.
          selector: `CallExpression[callee.object.name='console'] Property[value.name=${CAUGHT}]`,
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
    // Here for the rule above. What it breaks of the others is a backlog, like the
    // other root-level files in the ignores below.
    files: ["server.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/prefer-optional-chain": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
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
    ],
  },
];
