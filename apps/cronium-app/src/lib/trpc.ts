import { createTRPCReact, type CreateTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { type AppRouter } from "@/server/api/root";
import { PROXY_REFUSED_REQUEST_MESSAGE } from "@/shared/request-limits";
import superjson from "superjson";

export const trpc: CreateTRPCReact<AppRouter, unknown> =
  createTRPCReact<AppRouter>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Whether this is one call's answer in tRPC's format, through this link's transformer. */
function isTrpcAnswer(answer: unknown): boolean {
  if (!isObject(answer)) return false;
  if ("error" in answer) {
    return (
      isObject(answer.error) &&
      isObject(answer.error.json) &&
      typeof answer.error.json.code === "number"
    );
  }
  return (
    isObject(answer.result) &&
    isObject(answer.result.data) &&
    "json" in answer.result.data
  );
}

/** Whether the link could read this body. A batch gets a list, unless all of it failed. */
function isTrpcBody(body: unknown): boolean {
  return Array.isArray(body)
    ? body.length > 0 && body.every(isTrpcAnswer)
    : isTrpcAnswer(body);
}

function parsedOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * What the app says when a response to a tRPC call isn't Cronium's. All it knows is the
 * status and that it can't read the rest, so it offers causes without choosing one. A proxy's
 * 5xx can come after Cronium has acted on the request, and only a read gets retried, so a
 * save says it may have gone through, for someone about to press the button again. It says
 * a new tab because reloading this one would lose what's in a form.
 */
function notCroniumMessage(response: Response, method?: string): string {
  // A browser doesn't show where a redirect was going, or its status.
  if (response.type === "opaqueredirect") {
    return "Got a redirect, not Cronium's answer. It may be to a sign-in page: open Cronium in a new tab to check.";
  }
  if (response.status === 413) return PROXY_REFUSED_REQUEST_MESSAGE;
  const answer = `Got HTTP ${response.status}, not Cronium's answer`;
  if (response.status < 500) {
    return `${answer}. It may be from a reverse proxy, firewall or sign-in page: open Cronium in a new tab to check.`;
  }
  const causes =
    "Cronium may be restarting, or a reverse proxy in front of it can't reach it.";
  return method === "GET"
    ? `${answer}. ${causes}`
    : `${answer}, so this may still have gone through. ${causes}`;
}

/**
 * Has `response.json()`, which the link calls first and whose failure loses the status,
 * refuse anything that isn't tRPC's and say what came back. It reads the body once, as the
 * link would have, so a long answer costs no more than it did. It decides by the body and
 * not the status because Cronium answers at many of the statuses a proxy does, 403, 413 and
 * 500 among them, and a proxy can answer at 200. A lost connection or an aborted call fails
 * in `text()`, and goes on as that.
 */
function readingOnlyTrpc(response: Response, method?: string): Response {
  response.json = async () => {
    const body = parsedOrUndefined(await response.text());
    if (isTrpcBody(body)) return body;
    throw new Error(notCroniumMessage(response, method));
  };
  return response;
}

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      // Cronium never redirects these. A sign-in proxy does, usually to another origin, which
      // the browser refuses to follow and reports only as `Failed to fetch`.
      async fetch(input, init) {
        const request = {
          ...(init as RequestInit),
          redirect: "manual" as const,
        };
        return readingOnlyTrpc(await fetch(input, request), request.method);
      },
      // You can pass any HTTP headers you wish here
      async headers() {
        return {
          // authorization: getAuthCookie(),
        };
      },
      transformer: superjson,
    }),
  ],
});
