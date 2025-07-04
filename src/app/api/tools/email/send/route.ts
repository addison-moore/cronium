import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { encryptionService } from "@/lib/encryption-service";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { toolId, recipients, subject, message } = await request.json();

    if (!toolId || !recipients || !subject || !message) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing required fields: toolId, recipients, subject, or message",
        },
        { status: 400 },
      );
    }

    let credentials;

    if (toolId === -1) {
      // Use system SMTP settings
      const { getSmtpSettings } = await import("@/lib/email");
      const systemSmtp = await getSmtpSettings();

      if (!systemSmtp.enabled) {
        return NextResponse.json(
          { success: false, error: "System SMTP is not enabled" },
          { status: 400 },
        );
      }

      credentials = {
        smtpHost: systemSmtp.host,
        smtpPort: systemSmtp.port,
        smtpUser: systemSmtp.user,
        smtpPassword: systemSmtp.password,
        fromEmail: systemSmtp.fromEmail,
        fromName: systemSmtp.fromName,
      };
    } else {
      // Get the email tool credentials
      const toolResults = await db
        .select()
        .from(toolCredentials)
        .where(
          and(
            eq(toolCredentials.id, toolId),
            eq(toolCredentials.userId, session.user.id),
          ),
        );

      const tool = toolResults[0];
      if (!tool) {
        return NextResponse.json(
          { success: false, error: "Email tool not found or access denied" },
          { status: 404 },
        );
      }

      if (tool.type !== "EMAIL") {
        return NextResponse.json(
          { success: false, error: "Tool is not an email tool" },
          { status: 400 },
        );
      }

      // Decrypt credentials
      credentials = JSON.parse(encryptionService.decrypt(tool.credentials));
    }

    // Parse recipients (comma-separated string to array)
    const recipientList = recipients
      .split(",")
      .map((email: string) => email.trim())
      .filter((email: string) => email.length > 0);

    if (recipientList.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid recipients provided" },
        { status: 400 },
      );
    }

    // Send email to each recipient using tool credentials
    const results = [];
    for (const recipient of recipientList) {
      try {
        const emailSent = await sendEmail(
          {
            to: recipient,
            subject: subject,
            text: message,
            html: message.replace(/\n/g, "<br>"), // Simple HTML conversion
          },
          {
            host: credentials.smtpHost,
            port: credentials.smtpPort,
            user: credentials.smtpUser,
            password: credentials.smtpPassword,
            fromEmail: credentials.fromEmail,
            fromName: credentials.fromName,
          },
        );

        results.push({
          recipient,
          success: emailSent,
          error: emailSent ? null : "Failed to send email",
        });
      } catch (error) {
        console.error(`Failed to send email to ${recipient}:`, error);
        results.push({
          recipient,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Check if all emails were sent successfully
    const allSuccess = results.every((result) => result.success);
    const successCount = results.filter((result) => result.success).length;

    if (allSuccess) {
      return NextResponse.json({
        success: true,
        message: `Email sent successfully to ${successCount} recipient(s)`,
        results,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          message: `Email sent to ${successCount}/${results.length} recipients`,
          results,
        },
        { status: 207 },
      ); // Multi-status
    }
  } catch (error) {
    console.error("Email sending error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error while sending email",
      },
      { status: 500 },
    );
  }
}
