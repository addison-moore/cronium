import { timingSafeEqual } from "node:crypto";

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Resolve browser origins allowed to reach the Socket.IO transport. The
 * explicit list is useful when the app has more than one trusted frontend;
 * otherwise the canonical app/auth URLs are the safe defaults.
 */
export function resolveAllowedSocketOrigins(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = environment.SOCKET_ALLOWED_ORIGINS
    ? environment.SOCKET_ALLOWED_ORIGINS.split(",")
    : [environment.PUBLIC_APP_URL, environment.AUTH_URL];

  return [
    ...new Set(
      configured
        .filter((value): value is string => typeof value === "string")
        .map((value) => normalizeOrigin(value.trim()))
        .filter((value): value is string => value !== null),
    ),
  ];
}

export function isAllowedSocketOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  return normalized !== null && allowedOrigins.includes(normalized);
}

export function verifyInternalBroadcastAuthorization(
  authorization: string | undefined,
  expectedKey = process.env.INTERNAL_API_KEY,
): boolean {
  if (!authorization || !expectedKey) return false;

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match?.[1]) return false;

  const received = Buffer.from(match[1]);
  const expected = Buffer.from(expectedKey);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
