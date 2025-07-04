import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { AppRouter } from "@/server/api/root";

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      // You can pass any HTTP headers you wish here
      async headers() {
        return {
          // authorization: getAuthCookie(),
        };
      },
    }),
  ],
});