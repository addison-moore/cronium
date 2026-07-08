/** @type {import('jest').Config} */
const nextJest = require("next/jest");

// Tests run without a real deployment env; skip t3-env validation when
// next/jest loads next.config.js (same approach as the lint scripts).
process.env.SKIP_ENV_VALIDATION ??= "1";

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: "./",
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@shared/(.*)$": "<rootDir>/src/shared/$1",
    "^@components/(.*)$": "<rootDir>/src/components/$1",
    "^@server/(.*)$": "<rootDir>/src/server/$1",
    "^@lib/(.*)$": "<rootDir>/src/lib/$1",
  },
  transformIgnorePatterns: ["/node_modules/(?!@hookform|next-auth|superjson)"],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);
