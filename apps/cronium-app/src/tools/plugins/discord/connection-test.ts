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

  // Discord webhooks return their metadata on GET without sending a message
  const response = await safeFetch(webhookUrl, {
    allowHosts: TOOL_HOSTS.discord,
  });
  if (!response.ok) {
    return testFailure(`Discord webhook error: ${response.status}`);
  }
  const data = (await response.json()) as { name?: string };
  return {
    success: true,
    message: "Discord connection test successful",
    details: { webhook: data.name ?? "Unknown" },
  };
}
