/** Shared JSON/CORS helpers for the OAuth + discovery routes. */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...CORS,
      ...extraHeaders,
    },
  });
}

/** OAuth error response (RFC 6749 §5.2 shape). */
export function oauthError(
  error: string,
  description: string,
  status = 400,
): Response {
  return jsonResponse({ error, error_description: description }, status);
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
