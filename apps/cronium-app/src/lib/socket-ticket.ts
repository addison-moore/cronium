import type { Socket } from "socket.io";
import { createHash } from "node:crypto";
import { randomId, signTicket, verifyTicket } from "@/lib/mcp-oauth/tokens";
import { storage } from "@/server/storage";
import { consumeSocketTicketOnce } from "@/server/socket-security-store";
import { UserStatus, type UserRole } from "@/shared/schema";

export const SOCKET_TICKET_TTL_SECONDS = 30;

export const SOCKET_TICKET_AUDIENCES = ["terminal", "logs"] as const;
export type SocketTicketAudience = (typeof SOCKET_TICKET_AUDIENCES)[number];

interface SocketTicketClaims {
  typ: "cronium-socket";
  v: 1;
  sub: string;
  aud: SocketTicketAudience;
  jti: string;
  iat: number;
  exp: number;
}

export interface SocketPrincipal {
  userId: string;
  role: UserRole;
  authorizationFingerprint: string;
}

interface SocketUserRecord {
  id: string;
  role: UserRole;
  status: UserStatus;
  roleId?: number | null;
  password?: string | null;
}

export function socketUserAuthorizationFingerprint(
  user: SocketUserRecord,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([user.password, user.role, user.roleId, user.status]),
    )
    .digest("hex");
}

export interface AuthenticateSocketTicketOptions {
  now?: number;
  consumeTicket?: (
    jti: string,
    expiresAt: number,
    now: number,
  ) => Promise<boolean>;
  getUser?: (userId: string) => Promise<SocketUserRecord | undefined>;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isSocketTicketAudience(
  value: unknown,
): value is SocketTicketAudience {
  return SOCKET_TICKET_AUDIENCES.includes(value as SocketTicketAudience);
}

export function mintSocketTicket(
  userId: string,
  audience: SocketTicketAudience,
  now = nowSeconds(),
): { ticket: string; expiresIn: number } {
  if (!userId) {
    throw new Error("A user ID is required to mint a socket ticket");
  }

  const claims: SocketTicketClaims = {
    typ: "cronium-socket",
    v: 1,
    sub: userId,
    aud: audience,
    jti: randomId(18),
    iat: now,
    exp: now + SOCKET_TICKET_TTL_SECONDS,
  };

  return {
    ticket: signTicket(claims as unknown as Record<string, unknown>),
    expiresIn: SOCKET_TICKET_TTL_SECONDS,
  };
}

export function verifySocketTicket(
  ticket: string,
  audience: SocketTicketAudience,
  now = nowSeconds(),
): SocketTicketClaims | null {
  // Bound parser work before decoding an attacker-controlled handshake value.
  if (!ticket || ticket.length > 4096) return null;

  let claims: Partial<SocketTicketClaims> | null;
  try {
    claims = verifyTicket<Partial<SocketTicketClaims>>(ticket);
  } catch {
    return null;
  }
  if (!claims) return null;

  if (
    claims.typ !== "cronium-socket" ||
    claims.v !== 1 ||
    claims.aud !== audience ||
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    claims.sub.length > 255 ||
    typeof claims.jti !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(claims.jti) ||
    typeof claims.iat !== "number" ||
    !Number.isInteger(claims.iat) ||
    typeof claims.exp !== "number" ||
    !Number.isInteger(claims.exp) ||
    claims.exp <= now ||
    claims.iat > now + 5 ||
    claims.exp - claims.iat !== SOCKET_TICKET_TTL_SECONDS
  ) {
    return null;
  }

  return claims as SocketTicketClaims;
}

/**
 * Validate a short-lived ticket, consume it once in shared Valkey state, and
 * re-check the authoritative user row. Session claims alone are deliberately
 * insufficient because a user may have been disabled since signing in.
 */
export async function authenticateSocketTicket(
  ticket: string,
  audience: SocketTicketAudience,
  options: AuthenticateSocketTicketOptions = {},
): Promise<SocketPrincipal | null> {
  const now = options.now ?? nowSeconds();
  const claims = verifySocketTicket(ticket, audience, now);
  if (!claims) return null;

  const consumeTicket = options.consumeTicket ?? consumeSocketTicketOnce;
  try {
    if (!(await consumeTicket(claims.jti, claims.exp, now))) return null;
  } catch (error) {
    console.error("Socket ticket consumption failed:", error);
    return null;
  }

  const getUser = options.getUser ?? ((id: string) => storage.getUser(id));

  try {
    const user = await getUser(claims.sub);
    if (user?.id !== claims.sub || user.status !== UserStatus.ACTIVE) {
      return null;
    }

    return {
      userId: user.id,
      role: user.role,
      authorizationFingerprint: socketUserAuthorizationFingerprint(user),
    };
  } catch (error) {
    console.error("Socket authentication lookup failed:", error);
    return null;
  }
}

export function createSocketAuthMiddleware(
  audience: SocketTicketAudience,
  options: AuthenticateSocketTicketOptions = {},
): (socket: Socket, next: (error?: Error) => void) => void {
  return (socket, next) => {
    const ticket = (socket.handshake.auth as { ticket?: unknown }).ticket;
    if (typeof ticket !== "string") {
      next(new Error("Authentication required"));
      return;
    }

    void authenticateSocketTicket(ticket, audience, options)
      .then((principal) => {
        if (!principal) {
          next(new Error("Authentication failed"));
          return;
        }

        const socketData = socket.data as unknown as Record<string, unknown>;
        socketData.userId = principal.userId;
        socketData.role = principal.role;
        socketData.authorizationFingerprint =
          principal.authorizationFingerprint;
        next();
      })
      .catch((error) => {
        console.error("Socket authentication failed:", error);
        next(new Error("Authentication failed"));
      });
  };
}

export function getAuthenticatedSocketUserId(socket: Socket): string | null {
  const socketData = socket.data as unknown as Record<string, unknown>;
  return typeof socketData.userId === "string" ? socketData.userId : null;
}
