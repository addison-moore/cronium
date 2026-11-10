import {
  type ConnectionTestResult,
  testFailure,
} from "@/lib/tools/connection-test";

export async function testConnection(
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const smtpHost = credentials.smtpHost as string | undefined;
  const smtpPort = credentials.smtpPort as number | undefined;
  const smtpUser = credentials.smtpUser as string | undefined;
  const smtpPassword = credentials.smtpPassword as string | undefined;
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
    return testFailure("Missing required SMTP configuration");
  }
  // Ticked unless unticked, as the credential schema reads a missing box, so the test
  // can't sign in in plaintext where the send would refuse to.
  const requireTls = credentials.enableTLS !== false;

  const { buildSmtpTransport, explainRefusedStartTls } =
    await import("@/lib/email");
  const transporter = buildSmtpTransport({
    host: smtpHost,
    port: smtpPort,
    user: smtpUser,
    password: smtpPassword,
    secure: (credentials.enableSSL as boolean | undefined) ?? false,
    requireTls,
    allowSelfSigned: true,
  });
  await transporter.verify().catch((error: unknown) => {
    throw explainRefusedStartTls(error, { host: smtpHost, requireTls });
  });
  return {
    success: true,
    message: "SMTP connection verified successfully",
    details: { server: `${smtpHost}:${smtpPort}` },
  };
}
