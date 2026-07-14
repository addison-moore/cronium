import {
  type ConnectionTestResult,
  testFailure,
} from "@/lib/tools/connection-test";
import { safeFetch } from "@/lib/tools/safe-fetch";
import { TOOL_HOSTS } from "@/tools/utils/tool-hosts";

export async function testConnection(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const webhookUrl = credentials.webhookUrl as string | undefined;
  if (!webhookUrl) return testFailure("Webhook URL not found in credentials");

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
    return testFailure(
      `Slack webhook error: ${response.status} ${responseText}`,
    );
  }
  return { success: true, message: "Slack connection test successful" };
}
