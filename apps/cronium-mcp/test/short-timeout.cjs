// Loaded with --require. Shortens the bridge's 120-second limit, and only that one, so that a test
// of what happens at the limit doesn't take 120 seconds. The built bridge itself is unchanged.
const { timeout } = AbortSignal;
AbortSignal.timeout = (ms) =>
  timeout.call(AbortSignal, ms === 120_000 ? 500 : ms);
