import {
  type ConnectionTestResult,
  testFailure,
  fetchWithTimeout,
} from "@/lib/tools/connection-test";

export async function testConnection(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const oauthToken = credentials.oauthToken as string | undefined;
  if (!oauthToken) {
    return testFailure(
      "Google account not connected. Connect your Google account to use Google Sheets.",
    );
  }

  // tokeninfo validates the token and its scopes without extra permissions
  const response = await fetchWithTimeout(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(oauthToken)}`,
  );
  if (!response.ok) {
    return testFailure("Google token is invalid or expired");
  }
  const data = (await response.json()) as { scope?: string; email?: string };
  const hasSheetsScope = data.scope
    ?.split(" ")
    .some((scope) => scope.includes("spreadsheets") || scope.includes("drive"));
  if (!hasSheetsScope) {
    return testFailure("Google token is missing the Sheets scope; reconnect");
  }
  return {
    success: true,
    message: "Google Sheets connection test successful",
    details: { account: data.email ?? "Unknown" },
  };
}
