import {
  type ConnectionTestResult,
  testFailure,
} from "@/lib/tools/connection-test";
import { sqlCredentialsSchema } from "./schemas";
import { getDriver } from "./drivers";

export async function testConnection(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const parsed = sqlCredentialsSchema.safeParse(credentials);
  if (!parsed.success) {
    return testFailure(
      parsed.error.issues[0]?.message ?? "Invalid SQL credentials",
    );
  }
  try {
    return await getDriver(parsed.data.dialect).testConnection(parsed.data);
  } catch (error) {
    return testFailure(
      error instanceof Error ? error.message : "Connection test failed",
    );
  }
}
