/**
 * Reading a failed query's error. Drizzle wraps the driver's error in
 * DrizzleQueryError, so the details are on `cause`: a check of `error.code` never
 * matches on the real path, only in a test that rejects with a hand-built object.
 */
export interface DriverError {
  /** A SQLSTATE if Postgres answered, or a Node code such as ECONNREFUSED. */
  code?: string;
  message?: string;
  name?: string;
  /** Only on an error Postgres itself sent. */
  severity?: string;
}

export function driverError(error: unknown): DriverError {
  const failure = (error ?? {}) as DriverError & { cause?: DriverError };
  return failure.cause ?? failure;
}

export function pgErrorCode(error: unknown): string | undefined {
  return driverError(error).code;
}
