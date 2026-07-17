import {
  type ConnectionTestResult,
  testFailure,
} from "@/lib/tools/connection-test";
import { mongoCredentialsSchema } from "./schemas";

export async function testConnection(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const parsed = mongoCredentialsSchema.safeParse(credentials);
  if (!parsed.success) {
    return testFailure(
      parsed.error.issues[0]?.message ?? "Invalid MongoDB credentials",
    );
  }
  try {
    const { testMongoConnection } = await import("./client");
    return await testMongoConnection(parsed.data);
  } catch (error) {
    return testFailure(
      error instanceof Error ? error.message : "Connection test failed",
    );
  }
}
