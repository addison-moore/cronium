import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

interface ContactRequest {
  subject?: string;
  email?: string;
  message?: string;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ContactRequest;
    const subject = body.subject?.trim();
    const email = body.email?.trim();
    const message = body.message?.trim();

    if (!subject || !email || !message) {
      return NextResponse.json(
        { success: false, error: "All fields are required." },
        { status: 400 },
      );
    }

    const to = getEnv("CONTACT_EMAIL_TO");
    const host = getEnv("CONTACT_SMTP_HOST");
    const portRaw = getEnv("CONTACT_SMTP_PORT");
    const user = getEnv("CONTACT_SMTP_USER");
    const pass = getEnv("CONTACT_SMTP_PASSWORD");
    const from = process.env.CONTACT_EMAIL_FROM ?? user;
    const secure = process.env.CONTACT_SMTP_SECURE === "true";

    const transporter = nodemailer.createTransport({
      host,
      port: Number(portRaw),
      secure,
      auth: {
        user,
        pass,
      },
    });

    await transporter.sendMail({
      from,
      to,
      replyTo: email,
      subject: `[Cronium Contact] ${subject}`,
      text: `${message}\n\nFrom: ${email}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Contact form submission failed", error);
    const message =
      error instanceof Error ? error.message : "Failed to send message";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
