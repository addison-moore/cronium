import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { RATE_LIMIT_UNAVAILABLE } from "@/shared/rate-limit";

interface NextAuthRouteContext {
  params: Promise<{ nextauth: string[] }>;
}

type RouteHandler = (
  req: Request,
  context: NextAuthRouteContext,
) => Promise<Response>;

const handler = NextAuth(authOptions) as RouteHandler;

/** The `error` in the `{ url }` NextAuth answers a refused sign-in with. */
function refusalCode(body: string): string | null {
  try {
    const { url } = JSON.parse(body) as { url?: unknown };
    return typeof url === "string"
      ? new URL(url, "http://localhost").searchParams.get("error")
      : null;
  } catch {
    return null;
  }
}

/**
 * NextAuth answers every sign-in that `authorize` throws on with a 401. One refused because the
 * rate limiter couldn't be asked says nothing about the credentials, so it becomes a 503, as the
 * tRPC step before it answers. Only the status changes: the body and cookies are NextAuth's, and
 * `signIn()` reads the error from the body whatever the status. A form posted without `json`
 * gets NextAuth's redirect to the error page as before.
 */
const POST: RouteHandler = async (req, context) => {
  const response = await handler(req, context);
  if (response.status !== 401) return response;
  const body = await response.clone().text();
  if (refusalCode(body) !== RATE_LIMIT_UNAVAILABLE) return response;
  return new Response(body, { status: 503, headers: response.headers });
};

export { handler as GET, POST };
