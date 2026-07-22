import { NextResponse } from "next/server";
import nodemailer, { type Transporter } from "nodemailer";

// Hardened public contact endpoint (security plan Phase 4.3). Every input is
// bounded, delivery is time/concurrency-limited, a reusable SMTP transport is
// shared across requests, and public responses are generic (detail stays in the
// server log only).

const MAX_BODY_BYTES = 16 * 1024;
const LIMITS = { subject: 200, email: 254, message: 5000 } as const;

// Simple in-process fixed-window rate limit. A marketing site runs as a single
// instance; this is adequate bot/abuse throttling without a shared store.
const RATE_MAX = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const rateStore = new Map<string, { count: number; resetAt: number }>();

// Bound concurrent SMTP deliveries so a burst cannot exhaust connections.
const MAX_CONCURRENT_SENDS = 3;
let inFlight = 0;

const SMTP_TIMEOUT_MS = 10_000;

// Reasonable email shape check (not a full RFC 5322 parser): a single @, no
// spaces, a dotted domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ContactRequest {
  subject?: unknown;
  email?: unknown;
  message?: unknown;
  // Honeypot: a hidden field real users never fill. Bots that fill every input
  // get silently dropped.
  website?: unknown;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  // Opportunistically drop expired entries so the map cannot grow unbounded.
  for (const [key, v] of rateStore) {
    if (v.resetAt <= now) rateStore.delete(key);
  }
  const entry = rateStore.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateStore.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

let transporter: Transporter | null = null;
function getTransport(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: getEnv("CONTACT_SMTP_HOST"),
    port: Number(getEnv("CONTACT_SMTP_PORT")),
    secure: process.env.CONTACT_SMTP_SECURE === "true",
    auth: {
      user: getEnv("CONTACT_SMTP_USER"),
      pass: getEnv("CONTACT_SMTP_PASSWORD"),
    },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    pool: true,
    maxConnections: MAX_CONCURRENT_SENDS,
  });
  return transporter;
}

function requireString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  // Cap the body before parsing.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { success: false, error: "Request too large." },
      { status: 413 },
    );
  }

  let body: ContactRequest;
  try {
    body = JSON.parse(raw) as ContactRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 },
    );
  }

  // Honeypot: a bot filled the hidden field. Pretend success and drop it.
  if (typeof body.website === "string" && body.website.trim().length > 0) {
    return NextResponse.json({ success: true });
  }

  const subject = requireString(body.subject, LIMITS.subject);
  const email = requireString(body.email, LIMITS.email);
  const message = requireString(body.message, LIMITS.message);
  if (!subject || !email || !message || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      {
        success: false,
        error: "Please provide a valid subject, email, and message.",
      },
      { status: 400 },
    );
  }

  if (inFlight >= MAX_CONCURRENT_SENDS) {
    return NextResponse.json(
      { success: false, error: "Server busy. Please try again shortly." },
      { status: 503 },
    );
  }

  inFlight += 1;
  try {
    const to = getEnv("CONTACT_EMAIL_TO");
    const from = process.env.CONTACT_EMAIL_FROM ?? getEnv("CONTACT_SMTP_USER");

    await getTransport().sendMail({
      from,
      to,
      replyTo: email,
      subject: `[Cronium Contact] ${subject}`,
      text: `${message}\n\nFrom: ${email}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // Keep detail in the server log only; never leak SMTP/env detail publicly.
    console.error("Contact form submission failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to send message. Please try again later.",
      },
      { status: 500 },
    );
  } finally {
    inFlight -= 1;
  }
}
