import { z } from "zod";
import { protectedProcedure, createTRPCRouter } from "../../trpc";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import {
  credentialEncryption,
  type EncryptedData,
} from "@/lib/security/credential-encryption";
import { emailSendSchema } from "@/tools/plugins/email/schemas";
import nodemailer from "nodemailer";

// Email-specific schemas
const emailTestSchema = z.object({
  toolId: z.number().int().positive(),
});

// Helper to get and decrypt tool credentials
async function getEmailTool(userId: string, toolId: number) {
  const tool = await db.query.toolCredentials.findFirst({
    where: and(
      eq(toolCredentials.userId, userId),
      eq(toolCredentials.id, toolId),
      eq(toolCredentials.type, "EMAIL"),
    ),
  });

  if (!tool) {
    return null;
  }

  // Decrypt credentials
  let parsedCredentials: Record<string, unknown> = {};
  if (tool.encrypted && tool.credentials) {
    try {
      const encryptedData = JSON.parse(tool.credentials) as EncryptedData;
      const decrypted = await credentialEncryption.decrypt(encryptedData);
      parsedCredentials =
        typeof decrypted === "string"
          ? (JSON.parse(decrypted) as Record<string, unknown>)
          : (decrypted as Record<string, unknown>);
    } catch (error) {
      console.error("Failed to decrypt Email credentials:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to decrypt credentials",
      });
    }
  } else if (tool.credentials) {
    try {
      parsedCredentials =
        typeof tool.credentials === "string"
          ? (JSON.parse(tool.credentials) as Record<string, unknown>)
          : (tool.credentials as Record<string, unknown>);
    } catch {
      parsedCredentials = {};
    }
  }

  return {
    ...tool,
    credentials: parsedCredentials,
  };
}

export const emailRouter = createTRPCRouter({
  send: protectedProcedure
    .input(emailSendSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getEmailTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email tool not found",
        });
      }

      if (!tool.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Email tool is not active",
        });
      }

      try {
        // Create transporter
        const transporter = nodemailer.createTransport({
          host: tool.credentials.smtpHost as string,
          port: tool.credentials.smtpPort as number,
          secure: tool.credentials.enableSSL as boolean, // true for 465, false for other ports
          auth: {
            user: tool.credentials.smtpUser as string,
            pass: tool.credentials.smtpPassword as string,
          },
          tls: {
            rejectUnauthorized: false, // Accept self-signed certificates
          },
        });

        // Build mail options
        const mailOptions: nodemailer.SendMailOptions = {
          from: {
            name: (tool.credentials.fromName as string) || "Cronium",
            address: tool.credentials.fromEmail as string,
          },
          to: input.recipients,
          subject: input.subject,
          text: input.isHtml ? undefined : input.message,
          html: input.isHtml ? input.message : undefined,
          cc: input.cc,
          bcc: input.bcc,
          replyTo: input.replyTo,
          priority: input.priority,
        };

        // Add attachments if provided
        if (input.attachments && input.attachments.length > 0) {
          mailOptions.attachments = input.attachments.map((att) => ({
            filename: att.filename,
            content: Buffer.from(att.content, "base64"),
            contentType: att.contentType,
          }));
        }

        // Send email
        const info = await transporter.sendMail(mailOptions);

        return {
          success: true,
          message: "Email sent successfully",
          messageId: info.messageId,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        console.error("Email send error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to send email",
        });
      }
    }),

  testConnection: protectedProcedure
    .input(emailTestSchema)
    .mutation(async ({ ctx, input }) => {
      const tool = await getEmailTool(ctx.session.user.id, input.toolId);

      if (!tool) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email tool not found",
        });
      }

      try {
        // Create transporter
        const transporter = nodemailer.createTransport({
          host: tool.credentials.smtpHost as string,
          port: tool.credentials.smtpPort as number,
          secure: tool.credentials.enableSSL as boolean,
          auth: {
            user: tool.credentials.smtpUser as string,
            pass: tool.credentials.smtpPassword as string,
          },
          tls: {
            rejectUnauthorized: false,
          },
        });

        // Verify connection
        await transporter.verify();

        return {
          success: true,
          message: "Email connection test successful",
          details: {
            host: tool.credentials.smtpHost as string,
            port: tool.credentials.smtpPort as number,
            user: tool.credentials.smtpUser as string,
          },
        };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : "Connection failed",
        };
      }
    }),
});
