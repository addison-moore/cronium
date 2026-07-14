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

  const { buildSmtpTransport } = await import("@/lib/email");
  const transporter = buildSmtpTransport({
    host: smtpHost,
    port: smtpPort,
    user: smtpUser,
    password: smtpPassword,
    secure: (credentials.enableSSL as boolean | undefined) ?? false,
    allowSelfSigned: true,
  });
  await transporter.verify();
  return {
    success: true,
    message: "SMTP connection verified successfully",
    details: { server: `${smtpHost}:${smtpPort}` },
  };
}
