import {
  type ConnectionTestResult,
  testFailure,
  fetchWithTimeout,
} from "@/lib/tools/connection-test";

export async function testConnection(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const apiKey = credentials.apiKey as string | undefined;
  if (!apiKey) return testFailure("API key not found in credentials");

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
    return testFailure(`Notion API error: ${response.status}`);
  }
  const data = (await response.json()) as { name?: string };
  return {
    success: true,
    message: "Notion connection test successful",
    details: { workspace: data.name ?? "Unknown" },
  };
}
