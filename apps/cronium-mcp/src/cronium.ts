import superjson from "superjson";

/**
 * Minimal tRPC-over-HTTP client for Cronium, speaking the non-batch httpLink
 * wire format with the superjson transformer the app uses. Authenticates with a
 * Cronium API token (bearer) — the app's tRPC context accepts it (see
 * createTRPCContext / sessionFromApiToken).
 *
 * We hand-roll this rather than import the app's AppRouter type to avoid a
 * cross-package build coupling; the app performs the authoritative validation.
 */
export class CroniumClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    // Normalize: strip trailing slash so we can append /api/trpc/<path>.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.token}`,
      // Provenance: records created through this server are tagged source="mcp".
      "x-cronium-source": "mcp",
    };
  }

  async query<T = unknown>(path: string, input?: unknown): Promise<T> {
    let url = `${this.baseUrl}/api/trpc/${path}`;
    if (input !== undefined) {
      const serialized = JSON.stringify(superjson.serialize(input));
      url += `?input=${encodeURIComponent(serialized)}`;
    }
    const res = await fetch(url, { method: "GET", headers: this.headers() });
    return this.parse<T>(res, path);
  }

  async mutate<T = unknown>(path: string, input: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/trpc/${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(superjson.serialize(input)),
    });
    return this.parse<T>(res, path);
  }

  private async parse<T>(res: Response, path: string): Promise<T> {
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      throw new Error(
        `Cronium ${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
      );
    }

    if (!res.ok) {
      throw new Error(
        `Cronium ${path} failed (HTTP ${res.status}): ${errorMessage(body)}`,
      );
    }

    // Success envelope: { result: { data: <superjson payload> } }
    const data = (body as { result?: { data?: unknown } })?.result?.data;
    if (data === undefined) {
      throw new Error(`Cronium ${path} returned an unexpected envelope`);
    }
    return superjson.deserialize(data as never) as T;
  }
}

function errorMessage(body: unknown): string {
  const err = (body as { error?: unknown })?.error;
  if (!err) return "unknown error";
  // Transformer-wrapped ({ json: {...} }) or plain.
  const j = (err as { json?: unknown }).json ?? err;
  const msg = (j as { message?: unknown }).message;
  return typeof msg === "string" ? msg : JSON.stringify(j);
}
