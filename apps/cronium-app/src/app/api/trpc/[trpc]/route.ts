import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@server/api/root";
import { createTRPCContext } from "@server/api/trpc";
import { type NextRequest } from "next/server";
import { env } from "@/env.mjs";
import { withBodyLimit } from "@/lib/request-body";
import {
  EVENT_TOO_LONG_MESSAGE,
  MAX_REQUEST_BODY_BYTES,
  REQUEST_TOO_LONG_MESSAGE,
} from "@/shared/request-limits";

/** The procedures that take a script. A batched request names several, with commas. */
const EVENT_SAVES = ["events.create", "events.update"];

/**
 * This wraps the tRPC API handlers with a Next.js API route
 * https://trpc.io/docs/server/adapters/fetch
 */
const handler = (req: NextRequest) => {
  const procedures = req.nextUrl.pathname.split("/").pop()?.split(",") ?? [];
  const tooLongMessage = procedures.some((path) => EVENT_SAVES.includes(path))
    ? EVENT_TOO_LONG_MESSAGE
    : REQUEST_TOO_LONG_MESSAGE;

  const config: Parameters<typeof fetchRequestHandler>[0] = {
    endpoint: "/api/trpc",
    // tRPC reads the body itself, once a procedure's auth has passed, and answers with
    // whatever that read throws, in its own format and for each call in a batch.
    req: withBodyLimit(
      req,
      MAX_REQUEST_BODY_BYTES,
      () =>
        new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: tooLongMessage }),
    ),
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
  };

  if (env.NODE_ENV === "development") {
    config.onError = ({ path, error }) => {
      console.error(
        `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
      );
    };
  }

  return fetchRequestHandler(config);
};

export { handler as GET, handler as POST };
