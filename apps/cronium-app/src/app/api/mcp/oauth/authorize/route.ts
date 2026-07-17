import { getCachedServerSession } from "@/lib/auth-cache";
import { getBearerToken, authenticateApiToken } from "@/lib/api-auth";
import { getClient, putAuthCode } from "@/lib/mcp-oauth/store";
import { randomId, signTicket, verifyTicket } from "@/lib/mcp-oauth/tokens";
import {
  getBaseUrl,
  resourceUrl,
  DEFAULT_SCOPE,
} from "@/lib/mcp-oauth/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

function htmlError(message: string, status = 400): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Authorization error</title>` +
      `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
      `<h1 style="font-size:1.25rem">Authorization error</h1><p>${escapeHtml(message)}</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

// Resource owner: browser session first, then a Cronium API token (headless/CLI).
async function resolveOwner(req: Request): Promise<string | null> {
  const session = await getCachedServerSession();
  if (session?.user?.id) return session.user.id;
  const token = getBearerToken(req.headers);
  if (token) {
    const auth = await authenticateApiToken(token);
    if (auth) return auth.userId;
  }
  return null;
}

function redirectBack(
  redirectUri: string,
  state: string,
  params: Record<string, string>,
): Response {
  const sep = redirectUri.includes("?") ? "&" : "?";
  const qs = new URLSearchParams({
    ...(state ? { state } : {}),
    ...params,
  }).toString();
  return Response.redirect(`${redirectUri}${sep}${qs}`, 302);
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.searchParams;
  const clientId = p.get("client_id");
  const redirectUri = p.get("redirect_uri");
  const responseType = p.get("response_type");
  const codeChallenge = p.get("code_challenge");
  const ccMethod = p.get("code_challenge_method");
  const scope = p.get("scope") ?? DEFAULT_SCOPE;
  const state = p.get("state") ?? "";
  const consent = p.get("consent");
  const base = getBaseUrl(req);
  const aud = resourceUrl(base);

  // Validate client + redirect_uri BEFORE any redirect.
  if (!clientId) return htmlError("Missing client_id.");
  const client = await getClient(clientId);
  if (!client) {
    return htmlError(
      "Unknown client_id. Register via /api/mcp/oauth/register.",
    );
  }
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return htmlError("Invalid redirect_uri for this client.");
  }

  // From here, protocol errors redirect back to the validated redirect_uri.
  if (responseType !== "code") {
    return redirectBack(redirectUri, state, {
      error: "unsupported_response_type",
    });
  }
  if (!codeChallenge || ccMethod !== "S256") {
    return redirectBack(redirectUri, state, {
      error: "invalid_request",
      error_description: "PKCE with code_challenge_method=S256 is required",
    });
  }

  // Authenticate the resource owner.
  const sub = await resolveOwner(req);
  if (!sub) {
    const signin = `${base}/api/auth/signin?callbackUrl=${encodeURIComponent(req.url)}`;
    return Response.redirect(signin, 302);
  }

  if (consent === "deny") {
    return redirectBack(redirectUri, state, { error: "access_denied" });
  }

  if (!consent) {
    // Consent screen. Approve carries a signed ticket bound to this user +
    // params, so approve can't be CSRF'd.
    const ticket = signTicket({
      sub,
      cid: clientId,
      ru: redirectUri,
      cc: codeChallenge,
      exp: nowSec() + 300,
    });
    const approveUrl = `${url.href}&consent=${encodeURIComponent(ticket)}`;
    const denyUrl = `${url.href}&consent=deny`;
    const who = client.client_name
      ? escapeHtml(client.client_name)
      : "An application";
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Authorize ${who}</title>` +
        `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
        `<h1 style="font-size:1.25rem">Authorize access</h1>` +
        `<p><strong>${who}</strong> is requesting permission to <strong>create events and workflows</strong> ` +
        `in your Cronium account.</p>` +
        `<p style="color:#666;font-size:.9rem">Scope: ${escapeHtml(scope)}. It acts as you; ` +
        `created events start as drafts you review and activate.</p>` +
        `<div style="display:flex;gap:.75rem;margin-top:1.5rem">` +
        `<a href="${escapeHtml(approveUrl)}" style="background:#111;color:#fff;padding:.6rem 1.1rem;border-radius:.5rem;text-decoration:none">Approve</a>` +
        `<a href="${escapeHtml(denyUrl)}" style="padding:.6rem 1.1rem;border-radius:.5rem;text-decoration:none;border:1px solid #ccc;color:#111">Deny</a>` +
        `</div></body>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  // Approve: consent must be a valid ticket for THIS user + params.
  const ticket = verifyTicket<{
    sub: string;
    cid: string;
    ru: string;
    cc: string;
  }>(consent);
  if (
    ticket?.sub !== sub ||
    ticket.cid !== clientId ||
    ticket.ru !== redirectUri ||
    ticket.cc !== codeChallenge
  ) {
    return redirectBack(redirectUri, state, {
      error: "access_denied",
      error_description: "Invalid or expired consent",
    });
  }

  const code = randomId(24);
  await putAuthCode(code, {
    sub,
    cid: clientId,
    redirectUri,
    codeChallenge,
    scope,
    resource: aud,
  });
  return redirectBack(redirectUri, state, { code });
}
