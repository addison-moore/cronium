import nodemailer from "nodemailer";
import { db } from "@/server/db";
import { env } from "../env.mjs";
import { systemSettings } from "@/shared/schema";
import fs from "fs";
import path from "path";
import {
  encryptionService,
  isSystemSettingSensitive,
} from "./encryption-service";

// Interface for email message
interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// Interface for custom SMTP credentials
interface SmtpCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

// Get SMTP settings from database
export async function getSmtpSettings() {
  // Fetch all settings
  const allSettings = await db.select().from(systemSettings);

  // Decrypt sensitive settings
  const decryptedSettings = allSettings.map((setting) => {
    if (isSystemSettingSensitive(setting.key)) {
      try {
        return {
          ...setting,
          value: encryptionService.decrypt(setting.value),
        };
      } catch (error) {
        console.error(`Error decrypting system setting ${setting.key}:`, error);
        // Return setting without decryption rather than failing
        return setting;
      }
    }
    return setting;
  });

  // Extract SMTP settings
  const smtpEnabled =
    decryptedSettings.find((s) => s.key === "smtpEnabled")?.value === "true";
  const smtpHost = decryptedSettings.find((s) => s.key === "smtpHost")?.value;
  const smtpPort = Number(
    decryptedSettings.find((s) => s.key === "smtpPort")?.value ?? 587,
  );
  const smtpUser = decryptedSettings.find((s) => s.key === "smtpUser")?.value;
  const smtpPassword = decryptedSettings.find(
    (s) => s.key === "smtpPassword",
  )?.value;
  const smtpFromEmail = decryptedSettings.find(
    (s) => s.key === "smtpFromEmail",
  )?.value;
  const smtpFromName = decryptedSettings.find(
    (s) => s.key === "smtpFromName",
  )?.value;

  // System name for email sender fallback
  const systemName =
    decryptedSettings.find((s) => s.key === "systemName")?.value ?? "Cronium";

  return {
    enabled: smtpEnabled,
    host: smtpHost,
    port: smtpPort,
    user: smtpUser,
    password: smtpPassword,
    fromEmail: smtpFromEmail ?? "noreply@example.com",
    fromName: smtpFromName ?? systemName,
  };
}

// Send an email using system SMTP settings or custom credentials
export async function sendEmail(
  message: EmailMessage,
  customSmtp?: SmtpCredentials,
): Promise<boolean> {
  try {
    let smtp;

    if (customSmtp) {
      // Use provided custom SMTP credentials
      smtp = {
        enabled: true,
        host: customSmtp.host,
        port: customSmtp.port,
        user: customSmtp.user,
        password: customSmtp.password,
        fromEmail: customSmtp.fromEmail,
        fromName: customSmtp.fromName,
      };
    } else {
      // Use system SMTP settings
      smtp = await getSmtpSettings();

      // If SMTP is not enabled, log and return
      if (!smtp.enabled) {
        console.log(
          "SMTP is not enabled. Skipping sending email to:",
          message.to,
        );
        console.log("Email would have contained:", message.subject);
        return false;
      }
    }

    // Ensure we have required SMTP settings
    if (!smtp.host || !smtp.user || !smtp.password) {
      console.error("Missing required SMTP settings");
      return false;
    }

    // Create transport
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465, // true for 465, false for other ports
      auth: {
        user: smtp.user,
        pass: smtp.password,
      },
    });

    // Send mail
    const info = await transporter.sendMail({
      from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    console.log("Email sent:", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
}

// Send an invitation email
export async function sendInvitationEmail(email: string, inviteToken: string) {
  const baseUrl = env.PUBLIC_APP_URL ?? `http://localhost:5000`;

  // Create invitation URL
  const inviteUrl = `${baseUrl}/auth/activate?token=${inviteToken}`;

  // Get system name for personalization
  const allSettings = await db.select().from(systemSettings);
  const systemName =
    allSettings.find((s) => s.key === "systemName")?.value ?? "Cronium";

  // Get HTML template and replace placeholders
  const htmlTemplate = getEmailTemplate("invitation", {
    systemName,
    inviteUrl,
  });

  return sendEmail({
    to: email,
    subject: `Invitation to join ${systemName}`,
    text: `
You've been invited to join ${systemName}!

Please click the link below to activate your account:
${inviteUrl}

This invitation link is valid for 48 hours.

If you did not request this invitation, please ignore this email.
    `,
    html: htmlTemplate,
  });
}

// Send a password reset email
export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
) {
  // Get base URL from environment or default
  const baseUrl = env.PUBLIC_APP_URL ?? `http://localhost:5000`;

  // Create reset URL
  const resetUrl = `${baseUrl}/en/auth/reset-password?token=${resetToken}`;

  // Get system name for personalization
  const allSettings = await db.select().from(systemSettings);
  const systemName =
    allSettings.find((s) => s.key === "systemName")?.value ?? "Cronium";

  // Get HTML template and replace placeholders
  const htmlTemplate = getEmailTemplate("password-reset", {
    systemName,
    resetUrl,
  });

  return sendEmail({
    to: email,
    subject: `Reset your ${systemName} password`,
    text: `
You requested to reset your password for ${systemName}.

Please click the link below to reset your password:
${resetUrl}

This password reset link is valid for 1 hour.

If you did not request this password reset, please ignore this email or contact support if you have concerns.
    `,
    html: htmlTemplate,
  });
}

/**
 * Read an email template from the email-templates directory and replace placeholders
 * @param templateName The name of the template file (without extension)
 * @param replacements Key-value pairs for placeholder replacements
 * @returns The processed HTML template
 */
function getEmailTemplate(
  templateName: string,
  replacements: Record<string, string>,
): string {
  try {
    const templatePath = path.resolve(`email-templates/${templateName}.html`);
    let template = fs.readFileSync(templatePath, "utf-8");

    // Replace placeholders with actual values
    Object.entries(replacements).forEach(([key, value]) => {
      template = template.replace(new RegExp(`{{${key}}}`, "g"), value);
    });

    return template;
  } catch (error) {
    console.error(`Error processing email template ${templateName}:`, error);
    // Fallback to simple HTML if template can't be loaded
    return `<html><body>
      <h2>${replacements.subject ?? "Notification"}</h2>
      <p>${replacements.message ?? "Please check your dashboard for details."}</p>
    </body></html>`;
  }
}

/**
 * Send an event success notification email
 */
export async function sendEventSuccessEmail(
  to: string,
  eventName: string,
  executionTime: string,
  duration: string,
  output: string,
) {
  // Get system name for personalization
  const allSettings = await db.select().from(systemSettings);
  const systemName =
    allSettings.find((s) => s.key === "systemName")?.value ?? "Cronium";

  // Prepare replacements for the template
  const replacements = {
    systemName,
    eventName,
    executionTime,
    duration,
    output: output ?? "No output available",
  };

  // Get HTML from template
  const html = getEmailTemplate("event-success", replacements);

  // Generate a plain text version
  const text = `
Event Executed Successfully in ${systemName}

Event: ${eventName}
Execution Time: ${executionTime}
Duration: ${duration} seconds

Output:
${output ?? "No output available"}

This is an automated message from ${systemName}.
  `;

  return sendEmail({
    to,
    subject: `[${systemName}] Event Successful: ${eventName}`,
    text,
    html,
  });
}

/**
 * Send an event failure notification email
 */
export async function sendEventFailureEmail(
  to: string,
  eventName: string,
  executionTime: string,
  duration: string,
  error: string,
  output: string,
) {
  // Get system name for personalization
  const allSettings = await db.select().from(systemSettings);
  const systemName =
    allSettings.find((s) => s.key === "systemName")?.value ?? "Cronium";

  // Prepare replacements for the template
  const replacements = {
    systemName,
    eventName,
    executionTime,
    duration,
    error: error ?? "Unknown error",
    output: output ?? "No output available",
  };

  // Get HTML from template
  const html = getEmailTemplate("event-failure", replacements);

  // Generate a plain text version
  const text = `
Event Execution Failed in ${systemName}

Event: ${eventName}
Execution Time: ${executionTime}
Duration: ${duration} seconds

Error:
${error ?? "Unknown error"}

Output:
${output ?? "No output available"}

This is an automated message from ${systemName}.
  `;

  return sendEmail({
    to,
    subject: `[${systemName}] Event Failed: ${eventName}`,
    text,
    html,
  });
}
