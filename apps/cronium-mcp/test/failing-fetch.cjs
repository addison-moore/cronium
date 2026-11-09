// Loaded with --require. Makes every fetch fail with the cause in FETCH_FAILURE_CAUSE, for failures
// a test can't bring about here, such as an expired certificate or a network with no route out.
const cause = JSON.parse(process.env.FETCH_FAILURE_CAUSE);
globalThis.fetch = async () => {
  throw new TypeError("fetch failed", { cause });
};
