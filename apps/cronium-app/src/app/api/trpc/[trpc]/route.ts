import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@server/api/root";
import { createTRPCContext } from "@server/api/trpc";
import { type NextRequest } from "next/server";
import { env } from "@/env.mjs";
import { describeFailure } from "@/lib/pg-errors";

/**
 * This wraps the tRPC API handlers with a Next.js API route
 * https://trpc.io/docs/server/adapters/fetch
 */
const handler = (req: NextRequest) => {
  const config: Parameters<typeof fetchRequestHandler>[0] = {
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
  };

  if (env.NODE_ENV === "development") {
    config.onError = ({ path, error }) => {
      console.error(
        `❌ tRPC failed on ${path ?? "<no-path>"}: ${describeFailure(error)}`,
      );
    };
  }

  return fetchRequestHandler(config);
};

export { handler as GET, handler as POST };
