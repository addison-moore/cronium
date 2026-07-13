/**
 * Real connection tests for tool credentials.
 *
 * Shared by the generic `tools.testConnection` procedure (what the UI's Test
 * buttons call), the per-plugin tRPC sub-routers, and the plugin api-routes.
 * Every check makes a real network call against the provider; types without a
 * meaningful check report an honest failure instead of fake success.
 */

import { safeFetch } from "@/lib/tools/safe-fetch";
import { TOOL_HOSTS } from "@/tools/utils/tool-hosts";

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(
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

function failure(message: string): ConnectionTestResult {
  return { success: false, message };
}

function normalizeToolType(type: string): string {
  return type.toLowerCase().replace(/_/g, "-");
}

async function testEmail(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const smtpHost = credentials.smtpHost as string | undefined;
  const smtpPort = credentials.smtpPort as number | undefined;
  const smtpUser = credentials.smtpUser as string | undefined;
  const smtpPassword = credentials.smtpPassword as string | undefined;
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
    return failure("Missing required SMTP configuration");
  }

  const { buildSmtpTransport } = await import("@/lib/email");
  const transporter = buildSmtpTransport({
    host: smtpHost,
    port: smtpPort,
    user: smtpUser,
    password: smtpPassword,
    secure: (credentials.enableSSL as boolean | undefined) ?? false,
    allowSelfSigned: true,
  });
  await transporter.verify();
  return {
    success: true,
    message: "SMTP connection verified successfully",
    details: { server: `${smtpHost}:${smtpPort}` },
  };
}

async function testNotion(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const apiKey = credentials.apiKey as string | undefined;
  if (!apiKey) return failure("API key not found in credentials");

  const response = await fetchWithTimeout(
    "https://api.notion.com/v1/users/me",
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Notion-Version": "2022-06-28",
      },
    },
  );
  if (!response.ok) {
    return failure(`Notion API error: ${response.status}`);
  }
  const data = (await response.json()) as { name?: string };
  return {
    success: true,
    message: "Notion connection test successful",
    details: { workspace: data.name ?? "Unknown" },
  };
}

async function testTrello(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const apiKey = credentials.apiKey as string | undefined;
  const apiToken = credentials.apiToken as string | undefined;
  if (!apiKey || !apiToken) {
    return failure("API key and token are required");
  }

  const url = `https://api.trello.com/1/members/me?key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(apiToken)}&fields=fullName,username`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    return failure(`Trello API error: ${response.status}`);
  }
  const data = (await response.json()) as {
    fullName?: string;
    username?: string;
  };
  return {
    success: true,
    message: "Trello connection test successful",
    details: { member: data.fullName ?? data.username ?? "Unknown" },
  };
}

async function testSlack(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const webhookUrl = credentials.webhookUrl as string | undefined;
  if (!webhookUrl) return failure("Webhook URL not found in credentials");

  // Slack incoming webhooks have no side-effect-free check; this posts a
  // visible message to the configured channel. safeFetch enforces the host.
  const response = await safeFetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Cronium connection test" }),
    allowHosts: TOOL_HOSTS.slack,
  });
  const responseText = await response.text();
  if (!response.ok || responseText !== "ok") {
    return failure(`Slack webhook error: ${response.status} ${responseText}`);
  }
  return { success: true, message: "Slack connection test successful" };
}

async function testDiscord(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const webhookUrl = credentials.webhookUrl as string | undefined;
  if (!webhookUrl) return failure("Webhook URL not found in credentials");

  // Discord webhooks return their metadata on GET without sending a message
  const response = await safeFetch(webhookUrl, {
    allowHosts: TOOL_HOSTS.discord,
  });
  if (!response.ok) {
    return failure(`Discord webhook error: ${response.status}`);
  }
  const data = (await response.json()) as { name?: string };
  return {
    success: true,
    message: "Discord connection test successful",
    details: { webhook: data.name ?? "Unknown" },
  };
}

async function testTeams(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const webhookUrl = credentials.webhookUrl as string | undefined;
  if (!webhookUrl) return failure("Webhook URL not found in credentials");

  // Teams incoming webhooks accept a MessageCard POST; this posts a visible
  // message to the configured channel.
  const response = await safeFetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      summary: "Cronium connection test",
      text: "Cronium connection test",
    }),
    allowHosts: TOOL_HOSTS.teams,
  });
  const responseText = await response.text();
  if (!response.ok) {
    return failure(`Teams webhook error: ${response.status} ${responseText}`);
  }
  return { success: true, message: "Teams connection test successful" };
}

async function testGoogleSheets(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const oauthToken = credentials.oauthToken as string | undefined;
  if (!oauthToken) {
    return failure(
      "Google account not connected. Connect your Google account to use Google Sheets.",
    );
  }

  // tokeninfo validates the token and its scopes without extra permissions
  const response = await fetchWithTimeout(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(oauthToken)}`,
  );
  if (!response.ok) {
    return failure("Google token is invalid or expired");
  }
  const data = (await response.json()) as { scope?: string; email?: string };
  const hasSheetsScope = data.scope
    ?.split(" ")
    .some((scope) => scope.includes("spreadsheets") || scope.includes("drive"));
  if (!hasSheetsScope) {
    return failure("Google token is missing the Sheets scope; reconnect");
  }
  return {
    success: true,
    message: "Google Sheets connection test successful",
    details: { account: data.email ?? "Unknown" },
  };
}

/**
 * Run a real connection test for the given tool type and (decrypted)
 * credentials. Never throws for provider/network failures — returns an
 * honest `{success: false}` result instead.
 */
export async function testToolConnection(
  toolType: string,
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const type = normalizeToolType(toolType);
  try {
    switch (type) {
      case "email":
        return await testEmail(credentials);
      case "notion":
        return await testNotion(credentials);
      case "trello":
        return await testTrello(credentials);
      case "slack":
        return await testSlack(credentials);
      case "discord":
        return await testDiscord(credentials);
      case "teams":
        return await testTeams(credentials);
      case "google-sheets":
        return await testGoogleSheets(credentials);
      default:
        return failure(`No connection test available for ${toolType}`);
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Connection test timed out"
        : error instanceof Error
          ? error.message
          : "Connection test failed";
    return failure(message);
  }
}
