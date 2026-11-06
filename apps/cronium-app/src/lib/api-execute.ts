/**
 * Request handling shared by the two "run it now" REST routes,
 * POST /api/events/{id}/execute and POST /api/workflows/{id}/execute. They exist
 * so CI can trigger runs; everything else programmatic goes through MCP.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  authenticateRestPrincipal,
  restPrincipalErrorResponse,
} from "@/lib/api-auth";
import { RateLimitService } from "@/lib/rate-limit-service";
import { readBodyWithin } from "@/lib/request-body";
import { resourceAccessHttpStatus } from "@/server/security/resource-access";

// The limiter keys on user id + path, and tRPC's `events.execute` uses the same
// numbers, so REST and tRPC draw from one budget instead of adding up.
const RATE_LIMIT = { maxRequests: 50, windowMs: 60_000 };
// The same ceiling as workflow webhooks: input is stored on the job row.
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_POSTGRES_INT = 2_147_483_647;

// Strict, so a misspelled or unsupported field is an error rather than a run
// that quietly ignores what the caller asked for.
const executeBodySchema = z
  .object({ input: z.record(z.string(), z.unknown()).optional() })
  .strict();

export type ExecuteRequest =
  | {
      ok: true;
      id: number;
      userId: string;
      input: Record<string, unknown> | undefined;
    }
  | { ok: false; response: NextResponse };

function parseResourceId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_POSTGRES_INT ? id : null;
}

function refuse(body: object, status: number, headers?: HeadersInit) {
  return {
    ok: false as const,
    response: NextResponse.json(body, {
      status,
      ...(headers && { headers }),
    }),
  };
}

/**
 * Authenticate, authorize and parse a run request. `scopePath` is the matching
 * tRPC procedure, so a token's scopes mean the same thing on either transport.
 * Ownership of the resource is left to the route, which holds the resource type.
 */
export async function parseExecuteRequest(
  request: NextRequest,
  rawId: string,
  scopePath: "events.execute" | "workflows.execute",
): Promise<ExecuteRequest> {
  const auth = await authenticateRestPrincipal(request, "execute", scopePath);
  if (!auth.ok) {
    return { ok: false, response: restPrincipalErrorResponse(auth) };
  }
  // Tokens only. An empty POST here runs code, so accepting the session cookie
  // would make these routes a CSRF target, and the app itself uses tRPC.
  if (auth.scopes === null) {
    return {
      ok: false,
      response: restPrincipalErrorResponse({ ok: false, status: 401 }),
    };
  }

  const id = parseResourceId(rawId);
  if (id === null) {
    return refuse({ error: "Invalid ID" }, 400);
  }

  const limit = await RateLimitService.tryCheckLimit(
    auth.userId,
    scopePath,
    RATE_LIMIT,
  );
  if (!limit.allowed) {
    return refuse({ error: "Rate limit exceeded" }, 429, {
      "Retry-After": limit.resetAt.toUTCString(),
    });
  }

  const rawBody = await readBodyWithin(request, MAX_BODY_BYTES);
  if (rawBody === null) {
    return refuse({ error: "Request body too large (max 1 MB)" }, 413);
  }

  // No body at all is the common CI call: run it with no input.
  let body: unknown = {};
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return refuse({ error: "Request body must be JSON" }, 400);
    }
  }

  const parsed = executeBodySchema.safeParse(body);
  if (!parsed.success) {
    return refuse(
      { error: "Validation failed", details: parsed.error.format() },
      400,
    );
  }

  return { ok: true, id, userId: auth.userId, input: parsed.data.input };
}

/** Map what the access checks and the enqueue path throw to a response. */
export function executeErrorResponse(
  error: unknown,
  resource: "Event" | "Workflow",
): NextResponse {
  const status = resourceAccessHttpStatus(error);
  if (status === 404) {
    return NextResponse.json({ error: `${resource} not found` }, { status });
  }
  if (status === 403) {
    return NextResponse.json({ error: "Access denied" }, { status });
  }
  console.error(
    `Failed to execute ${resource.toLowerCase()}:`,
    error instanceof Error ? error.message : String(error),
  );
  return NextResponse.json(
    { error: `Failed to execute ${resource.toLowerCase()}` },
    { status: 500 },
  );
}
