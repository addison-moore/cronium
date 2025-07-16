/**
 * Jest configuration for Cronium tests
 */

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/../src/$1",
    "^@shared/(.*)$": "<rootDir>/../src/shared/$1",
    "^@server/(.*)$": "<rootDir>/../src/server/$1",
    "^@lib/(.*)$": "<rootDir>/../src/lib/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  setupFilesAfterEnv: ["<rootDir>/setup.ts"],
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["text", "lcov", "html"],
  coveragePathIgnorePatterns: ["/node_modules/", "/dist/", "/.next/"],
  testTimeout: 30000, // 30 seconds for integration tests
  projects: [
    {
      displayName: "Unit Tests",
      testMatch: ["<rootDir>/unit/**/*.test.ts"],
      testEnvironment: "node",
    },
    {
      displayName: "Integration Tests",
      testMatch: ["<rootDir>/integration/**/*.test.ts"],
      testEnvironment: "node",
      testTimeout: 60000, // 60 seconds for integration tests
    },
    {
      displayName: "Performance Tests",
      testMatch: ["<rootDir>/performance/**/*.test.ts"],
      testEnvironment: "node",
      testTimeout: 300000, // 5 minutes for performance tests
    },
    {
      displayName: "Security Tests",
      testMatch: ["<rootDir>/security/**/*.test.ts"],
      testEnvironment: "node",
      testTimeout: 60000, // 60 seconds for security tests
    },
  ],
};
