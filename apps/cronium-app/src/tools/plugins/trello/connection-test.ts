import {
  type ConnectionTestResult,
  testFailure,
  fetchWithTimeout,
} from "@/lib/tools/connection-test";

export async function testConnection(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const apiKey = credentials.apiKey as string | undefined;
  const apiToken = credentials.apiToken as string | undefined;
  if (!apiKey || !apiToken) {
    return testFailure("API key and token are required");
  }

  const url = `https://api.trello.com/1/members/me?key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(apiToken)}&fields=fullName,username`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    return testFailure(`Trello API error: ${response.status}`);
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
