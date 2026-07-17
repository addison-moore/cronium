import {
  type ConnectionTestResult,
  testFailure,
} from "@/lib/tools/connection-test";
import { aiCredentialsSchema } from "./schemas";

/**
 * Validate an AI connection by asking the provider for its model list — a cheap
 * authenticated call that fails fast on a bad key or unreachable base URL.
 */
export async function testConnection(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const parsed = aiCredentialsSchema.safeParse(credentials);
  if (!parsed.success) {
    return testFailure(
      parsed.error.issues[0]?.message ?? "Invalid AI credentials",
    );
  }

  const { provider, apiKey, baseUrl } = parsed.data;
  try {
    // Lazy-loaded so importing the registry (which imports this module) doesn't
    // pull the AI layer's storage/env dependency chain at module load.
    const { listAvailableModels } = await import("@/lib/ai");
    const result = await listAvailableModels(
      provider,
      apiKey,
      baseUrl?.trim() ? baseUrl : undefined,
    );
    if (result.source === "provider") {
      return {
        success: true,
        message: `Connected — ${result.models.length} model(s) available`,
        details: { provider, modelCount: result.models.length },
      };
    }
    return testFailure(
      result.error
        ? `Could not reach ${provider}: ${result.error}`
        : `Could not verify the ${provider} connection`,
    );
  } catch (error) {
    return testFailure(
      error instanceof Error ? error.message : "Connection test failed",
    );
  }
}
