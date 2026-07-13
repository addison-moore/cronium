/**
 * Allowed outbound hosts per tool, plus pure host-matching helpers.
 *
 * Client-safe (no Node built-ins) so it can be shared by both the zod credential
 * schemas (which run in "use client" plugin modules) and the server-side
 * `safe-fetch` SSRF guard. This is the single source of truth for which hosts a
 * tool may talk to.
 */

/**
 * A leading "." means "this domain or any subdomain".
 * `satisfies` (not a `Record` annotation) keeps the keys literal so
 * `TOOL_HOSTS.slack` is `string[]`, not `string[] | undefined`.
 */
export const TOOL_HOSTS = {
  slack: ["hooks.slack.com"],
  discord: ["discord.com", "discordapp.com"],
  // Teams incoming webhooks: current *.webhook.office.com plus legacy outlook.office.com
  teams: [".webhook.office.com", "outlook.office.com"],
  notion: ["api.notion.com"],
  trello: ["api.trello.com"],
  "google-sheets": ["sheets.googleapis.com", "www.googleapis.com"],
} satisfies Record<string, string[]>;

export function hostAllowed(hostname: string, allow: string[]): boolean {
  const host = hostname.toLowerCase();
  return allow.some((entry) => {
    const e = entry.toLowerCase();
    if (e.startsWith(".")) {
      return host === e.slice(1) || host.endsWith(e);
    }
    return host === e;
  });
}

/**
 * True if `url` is a syntactically valid https URL whose host is in `allow`.
 * Used by credential/action schemas to reject bad webhook URLs at save time.
 * (The server-side safe-fetch performs the authoritative DNS/IP checks too.)
 */
export function isAllowedWebhookUrl(url: string, allow: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && hostAllowed(parsed.hostname, allow);
}
