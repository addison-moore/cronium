/**
 * Shared helpers for per-tool connection tests. Each tool owns its own
 * `connection-test.ts` (co-located with the plugin) and imports these; the tool
 * registry dispatches to them. This replaces the old central switch statement.
 */

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Timeout-bounded fetch for connection tests that hit a hardcoded provider host
 * (Notion/Trello/Google). Webhook-based tests (Slack/Discord/Teams) use
 * `safeFetch` directly, since their URL is user-supplied and needs the SSRF
 * allowlist.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function testFailure(message: string): ConnectionTestResult {
  return { success: false, message };
}
