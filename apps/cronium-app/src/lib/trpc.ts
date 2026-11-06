import { createTRPCReact, type CreateTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { type AppRouter } from "@/server/api/root";
import { PROXY_REFUSED_REQUEST_MESSAGE } from "@/shared/request-limits";
import superjson from "superjson";

export const trpc: CreateTRPCReact<AppRouter, unknown> =
  createTRPCReact<AppRouter>();

/** Whether a response body is an error in tRPC's format, through this link's transformer. */
function isTrpcError(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    const first = (Array.isArray(parsed) ? parsed[0] : parsed) as {
      error?: { json?: { code?: unknown } };
    } | null;
    return typeof first?.error?.json?.code === "number";
  } catch {
    return false;
  }
}

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      // A reverse proxy refuses a long request in its own format: an HTML page from nginx,
      // nothing at all from Caddy. The link parses any response as JSON before it looks at
      // the status, and loses the response when that fails, so a person would only see the
      // parser's complaint, never the 413. This is the last place that has the status.
      // Cronium's own 413 is a tRPC error with its own message, and goes on untouched.
      async fetch(input, init) {
        const response = await fetch(input, init as RequestInit);
        if (
          response.status === 413 &&
          !isTrpcError(await response.clone().text())
        ) {
          throw new Error(PROXY_REFUSED_REQUEST_MESSAGE);
        }
        return response;
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
