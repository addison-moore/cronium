import type net from "net";
import nodemailer from "nodemailer";
import { db } from "@/server/db";
import { env } from "../env.mjs";
import { systemSettings } from "@/shared/schema";
import fs from "fs";
import path from "path";
import {
  readSensitiveSetting,
  UnreadableSettingError,
} from "@/lib/security/unreadable-setting";
import { failureWithStack } from "@/lib/pg-errors";
import { connectWithSearch } from "@/lib/resolve-host";

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
  // Explicit TLS-on-connect override; defaults to port === 465
  secure?: boolean;
  // Sign in and send only over TLS: an Email credential's Enable TLS
  requireTls?: boolean;
  // Accept self-signed certificates (private SMTP servers)
  allowSelfSigned?: boolean;
}

// Result of a detailed send (real delivery info from the SMTP server)
export interface EmailSendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

/**
 * A server that answered STARTTLS with a refusal when the settings require TLS: one
 * without TLS does, and so can someone between here and the server. nodemailer says
 * "Error upgrading connection with STARTTLS: 502 ...", which doesn't say what to change,
 * and a run's error categorizer read the SMTP 502 as an HTTP one.
 */
export class StartTlsRefusedError extends Error {
  constructor(host: string, response: string, cause: unknown) {
    super(
      `${host} didn't switch to TLS when asked (STARTTLS), so Cronium didn't sign in or send anything. ` +
        "To use this server without encryption, untick Enable TLS on this credential. " +
        `The server answered: ${response}`,
      { cause },
    );
    this.name = "StartTlsRefusedError";
  }
}

/**
 * Explains nodemailer's error for a refused STARTTLS, and passes anything else on as it
 * was. Only when TLS was required: a server can also list STARTTLS and then refuse it,
 * and with Enable TLS unticked the box isn't why that failed. A failed TLS handshake,
 * such as a certificate the send won't take, has no answer from the server and keeps
 * nodemailer's own message. A session has a host by the time it fails, but a caller's
 * settings may not say so to the compiler.
 */
export function explainRefusedStartTls(
  error: unknown,
  smtp: { host?: string | undefined; requireTls?: boolean | undefined },
): unknown {
  if (!smtp.requireTls || typeof error !== "object" || error === null) {
    return error;
  }
  const { code, command, response } = error as Record<string, unknown>;
  return code === "ETLS" &&
    command === "STARTTLS" &&
    typeof response === "string"
    ? new StartTlsRefusedError(
        smtp.host ?? "The mail server",
        response.trim(),
        error,
      )
    : error;
}

// Get SMTP settings from database. Throws UnreadableSettingError if the saved
// password can't be decrypted, because there's no password to report.
export async function getSmtpSettings() {
  // Fetch all settings
  const allSettings = await db.select().from(systemSettings);
  const stored = (key: string) => allSettings.find((s) => s.key === key)?.value;

  // Extract SMTP settings
  const smtpHost = stored("smtpHost");
  const smtpPort = Number(stored("smtpPort") ?? 587);
  const smtpUser = stored("smtpUser");
  // The only secret decrypted here, so an AI key that can't be read can't stop email.
  const storedPassword = stored("smtpPassword");
  const smtpPassword =
    storedPassword === undefined
      ? undefined
      : readSensitiveSetting(storedPassword, "smtpPassword");
  const smtpFromEmail = stored("smtpFromEmail");
  const smtpFromName = stored("smtpFromName");

  // System name for email sender fallback
  const systemName = stored("systemName") ?? "Cronium";

  return {
    host: smtpHost,
    port: smtpPort,
    user: smtpUser,
    password: smtpPassword,
    fromEmail: smtpFromEmail ?? "noreply@example.com",
    fromName: smtpFromName ?? systemName,
  };
}

const SMTP_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Connects to the mail server here rather than in nodemailer, because a tool's host is
 * whatever its owner typed. nodemailer asks c-ares first, but when that gets no address,
 * which includes a name server that hangs under compose, it falls back to `dns.lookup`:
 * see lib/resolve-host.ts.
 *
 * nodemailer doesn't time this part, so `connectionTimeout` is applied here too. It does
 * the TLS itself, on this socket, for `secure` and STARTTLS alike.
 */
function connectToMailServer(
  host: string,
  port: number,
  callback: (
    error: Error | null,
    socketOptions: false | { connection: net.Socket },
  ) => void,
): void {
  const socket = connectWithSearch(host, port);
  const fail = (error: Error) => {
    clearTimeout(timer);
    socket.destroy();
    callback(error, false);
  };
  const timer = setTimeout(
    () =>
      fail(
        Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }),
      ),
    SMTP_CONNECTION_TIMEOUT_MS,
  );
  socket.once("error", fail);
  socket.once("connect", () => {
    clearTimeout(timer);
    socket.removeListener("error", fail);
    callback(null, { connection: socket });
  });
}

/** What nodemailer reports to a logger: an entry, then a message. */
type SmtpLogger = Record<
  "trace" | "debug" | "info" | "warn" | "error" | "fatal",
  (entry: { action?: unknown }, ...message: unknown[]) => void
>;

// Build a configured nodemailer transport. Single source of truth for SMTP
// connection options (secure flag, timeouts, self-signed handling) shared by
// the send paths and the connection tests.
export function buildSmtpTransport(opts: {
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean | undefined;
  // Without this, nodemailer uses STARTTLS only when the server lists it, so a server
  // without TLS, or someone who removes it from the list, gets the login and the message
  // in plaintext. With it, STARTTLS is asked for regardless, and a refusal or a failed
  // upgrade stops the session before AUTH. A `secure` connection is TLS already.
  requireTls?: boolean | undefined;
  allowSelfSigned?: boolean | undefined;
  // Hears what nodemailer reports as it goes, which is how a check learns it signed in.
  logger?: SmtpLogger | undefined;
}) {
  return nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure ?? opts.port === 465, // true for 465, false otherwise
    ...(opts.requireTls ? { requireTLS: true } : {}),
    auth: { user: opts.user, pass: opts.password },
    // Bound every phase so a scheduled execution can't hang: connect and
    // greeting were bounded, but a stall after the greeting (mid-send) could
    // still hang forever without socketTimeout.
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    getSocket: (_options, callback) =>
      connectToMailServer(opts.host, opts.port, callback),
    ...(opts.allowSelfSigned ? { tls: { rejectUnauthorized: false } } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
}

// The settings a send uses, whether a tool's own or the system's. A check of the login
// connects with the same transport, so it can't pass on settings the send then refuses.
function sendingTransport(
  smtp: {
    host?: string | undefined;
    port?: number | undefined;
    user?: string | undefined;
    password?: string | undefined;
    fromEmail?: string | undefined;
  },
  customSmtp: SmtpCredentials | undefined,
  logger?: SmtpLogger,
) {
  // Ensure we have required SMTP settings
  if (
    !smtp.host ||
    !smtp.port ||
    !smtp.user ||
    !smtp.password ||
    !smtp.fromEmail
  ) {
    throw new Error("SMTP_CONFIG_MISSING");
  }

  return buildSmtpTransport({
    host: smtp.host,
    port: smtp.port,
    user: smtp.user,
    password: smtp.password,
    secure: customSmtp?.secure,
    requireTls: customSmtp?.requireTls,
    allowSelfSigned: customSmtp?.allowSelfSigned,
    logger,
  });
}

/**
 * Connects and signs in as a send with these settings would, then quits before MAIL
 * FROM, so nothing is sent. nodemailer signs in only when the server offers AUTH, for a
 * send as for this, so `signedIn` says whether a password was accepted. Throws as the
 * send would on a refused login, a certificate it won't take, a STARTTLS refused while
 * TLS is required, or no answer.
 */
export async function checkSmtpLogin(
  smtp: SmtpCredentials,
): Promise<{ signedIn: boolean }> {
  let signedIn = false;
  const hear = (entry: { action?: unknown }) => {
    if (entry.action === "authenticated") signedIn = true;
  };
  const transporter = sendingTransport(smtp, smtp, {
    trace: hear,
    debug: hear,
    info: hear,
    warn: hear,
    error: hear,
    fatal: hear,
  });
  await transporter.verify().catch((error: unknown) => {
    throw explainRefusedStartTls(error, smtp);
  });
  return { signedIn };
}

// Send an email and return the SMTP server's delivery info. Throws on missing
// config, a saved password that can't be decrypted, or send failure (callers that
// need a boolean use sendEmail).
export async function sendEmailDetailed(
  message: EmailMessage,
  customSmtp?: SmtpCredentials,
): Promise<EmailSendResult> {
  // A tool's own settings, or the system's.
  const smtp = customSmtp ?? (await getSmtpSettings());

  // Create transport
  const transporter = sendingTransport(smtp, customSmtp);

  // Send mail
  const info = await transporter
    .sendMail({
      from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
    .catch((error: unknown) => {
      throw explainRefusedStartTls(error, {
        host: smtp.host,
        requireTls: customSmtp?.requireTls,
      });
    });

  console.log("Email sent:", info.messageId);
  return {
    messageId: info.messageId,
    accepted: info.accepted.map(String),
    rejected: info.rejected.map(String),
  };
}

// Send an email using system SMTP settings or custom credentials
export async function sendEmail(
  message: EmailMessage,
  customSmtp?: SmtpCredentials,
): Promise<boolean> {
  try {
    await sendEmailDetailed(message, customSmtp);
    return true;
  } catch (error) {
    // Both of these name something an administrator has to fix, not a bad send.
    if (
      error instanceof UnreadableSettingError ||
      (error instanceof Error && error.message === "SMTP_CONFIG_MISSING")
    ) {
      throw error;
    }
    console.error("Error sending email:", failureWithStack(error));
    return false;
  }
}

// Send an invitation email
export async function sendInvitationEmail(email: string, inviteToken: string) {
  const baseUrl = env.PUBLIC_APP_URL ?? `http://localhost:5000`;

  // Create invitation URL
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
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
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  const resetUrl = `${baseUrl}/auth/reset-password?token=${resetToken}`;

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
    console.error(
      `Error processing email template ${templateName}:`,
      failureWithStack(error),
    );
    // Fallback to simple HTML if template can't be loaded
    return `<html><body>
      <h2>${replacements.subject ?? "Notification"}</h2>
      <p>${replacements.message ?? "Please check your dashboard for details."}</p>
    </body></html>`;
  }
}
