/**
 * Test setup and utilities
 */

import { config } from "dotenv";
import path from "path";

// Load environment variables
config({ path: path.join(__dirname, "../.env.test") });

// Set test environment variables if not already set
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.INTERNAL_API_KEY =
  process.env.INTERNAL_API_KEY || "test-internal-api-key";
process.env.API_URL = process.env.API_URL || "http://localhost:5001";

// Mock console methods to reduce noise in tests
if (process.env.SUPPRESS_TEST_LOGS === "true") {
  global.console = {
    ...console,
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
}

// Global test utilities
global.testUtils = {
  /**
   * Wait for a condition to be true
   */
  waitFor: async (
    condition: () => boolean | Promise<boolean>,
    timeout = 5000,
    interval = 100,
  ) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error("Timeout waiting for condition");
  },

  /**
   * Create a delay
   */
  delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),

  /**
   * Generate a unique ID for testing
   */
  uniqueId: (prefix = "test") =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
};

// Extend Jest matchers
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () =>
          `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },
});

// Clean up after all tests
afterAll(async () => {
  // Close database connections
  const { db } = await import("@/server/db");
  await db.$client.end();

  // Close any open handles
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

// Declare global test utilities
declare global {
  const testUtils: {
    waitFor: (
      condition: () => boolean | Promise<boolean>,
      timeout?: number,
      interval?: number,
    ) => Promise<boolean>;
    delay: (ms: number) => Promise<void>;
    uniqueId: (prefix?: string) => string;
  };

  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(floor: number, ceiling: number): R;
    }
  }
}
