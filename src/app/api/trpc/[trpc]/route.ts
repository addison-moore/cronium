import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "../../../../server/api/root";
import { createTRPCContext } from "../../../../server/api/trpc";
import { type NextRequest } from "next/server";
import { env } from "@/env.mjs";

/**
 * This wraps the tRPC API handlers with a Next.js API route
 * https://trpc.io/docs/server/adapters/fetch
 */
const handler = (req: NextRequest) => {
  const config: Parameters<typeof fetchRequestHandler>[0] = {
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () =>
      createTRPCContext({ req: req as any, res: {} as any, info: {} as any }),
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
