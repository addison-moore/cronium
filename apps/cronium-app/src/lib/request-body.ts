/**
 * Reading a request's body with a limit on its length. A route can't rely on Next's own
 * cut-off for this, because that only leaves it with a shorter body and no way to know.
 */
import { NextResponse } from "next/server";
import {
  EVENT_TOO_LONG_MESSAGE,
  MAX_REQUEST_BODY_BYTES,
} from "@/shared/request-limits";

/**
 * The request body as text, or null once it passes `limit` bytes. Stops reading as
 * soon as it knows, rather than taking in the rest first. The declared length can't
 * be the only check, because a chunked request doesn't declare one.
 */
export async function readBodyWithin(
  request: Request,
  limit: number,
): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > limit) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      // Not awaited: the answer doesn't depend on how the stream shuts down.
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The JSON body of a REST request that saves an event, or the response refusing it. */
export async function readEventSaveBody(
  request: Request,
): Promise<
  { ok: true; body: unknown } | { ok: false; response: NextResponse }
> {
  const raw = await readBodyWithin(request, MAX_REQUEST_BODY_BYTES);
  if (raw === null) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: EVENT_TOO_LONG_MESSAGE },
        { status: 413 },
      ),
    };
  }
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Request body must be a JSON object under 10 MB" },
        { status: 400 },
      ),
    };
  }
}

/**
 * The same request with a body that fails with `tooLong()` rather than pass `limit`
 * bytes, for code that reads the body itself and answers whatever that read throws.
 */
export function withBodyLimit(
  request: Request,
  limit: number,
  tooLong: () => Error,
): Request {
  if (!request.body) return request;

  const declaredTooLong = Number(request.headers.get("content-length")) > limit;
  let bytes = 0;
  const body = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        if (declaredTooLong) controller.error(tooLong());
      },
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > limit) controller.error(tooLong());
        else controller.enqueue(chunk);
      },
    }),
  );

  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
    body,
    duplex: "half",
  } as RequestInit);
}
