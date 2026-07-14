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
    return testFailure(
      `Teams webhook error: ${response.status} ${responseText}`,
    );
  }
  return { success: true, message: "Teams connection test successful" };
}
