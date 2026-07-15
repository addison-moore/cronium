/**
 * Reject with a timeout error if `promise` doesn't settle within `ms`. The
 * underlying work is not cancelled (callers that hold real resources — e.g. the
 * SQL driver — close them in their own `finally`); this only bounds how long the
 * caller waits.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "Operation",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
