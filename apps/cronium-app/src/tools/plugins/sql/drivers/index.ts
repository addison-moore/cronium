import type { SqlDialect, SqlDriver } from "./types";
import { postgresDriver } from "./postgres";
import { mysqlDriver } from "./mysql";

const DRIVERS: Record<SqlDialect, SqlDriver> = {
  postgres: postgresDriver,
  mysql: mysqlDriver,
};

/**
 * Resolve the driver for a dialect. Throws on an unknown dialect so a
 * misconfigured credential fails loudly rather than silently no-op'ing.
 */
export function getDriver(dialect: string): SqlDriver {
  const driver = DRIVERS[dialect as SqlDialect];
  if (!driver) {
    throw new Error(
      `Unsupported SQL dialect "${dialect}". Supported: ${Object.keys(DRIVERS).join(", ")}.`,
    );
  }
  return driver;
}
