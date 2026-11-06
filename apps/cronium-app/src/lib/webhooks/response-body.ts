import { finished, type Readable } from "stream";

/** How long a receiver gets to send its status, and then to finish its body. */
export const WEBHOOK_TIMEOUT_MS = 30_000;

export interface ResponseBody {
  /** What arrived, up to the cap, as text. */
  text: string;
  /**
   * Why the body stopped before its end. Reaching the cap doesn't set this: a long
   * answer is a whole answer that we chose not to keep reading.
   */
  unfinished?: string;
}

/**
 * Reads the body of a response whose status is already known, and always resolves,
 * so whatever happens to the body, the caller keeps the status and what had arrived.
 *
 * It needs its own time limit: axios stops timing a request once it has handed over
 * the stream, so a receiver going quiet here would hold the delivery forever. The
 * limit is on the whole read, not on the gap between chunks, so a receiver can't hold
 * one of the queue's few slots by sending a byte at a time.
 *
 * Stopping early also closes the connection, through any decompression in between,
 * so the receiver stops sending. `maxBytes` counts what comes out of decompression,
 * so a small compressed body can't expand past it.
 */
export function readResponseBody(
  body: Readable,
  maxBytes: number,
  timeoutMs: number,
): Promise<ResponseBody> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const settle = (unfinished?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        // What axios does for a text response: UTF-8, without a byte order mark.
        text: Buffer.concat(chunks)
          .toString("utf8")
          .replace(/^\uFEFF/, ""),
        ...(unfinished !== undefined && { unfinished }),
      });
    };

    body.on("data", (chunk: Buffer) => {
      if (settled) return;
      chunks.push(chunk.subarray(0, maxBytes - received));
      received += chunk.length;
      if (received > maxBytes) {
        settle();
        body.destroy();
      }
    });

    // Not removed after it fires. It's also what listens for an `error` event, and
    // destroying a stream can still produce one.
    finished(body, (error) => {
      settle(
        error ? `The response didn't finish (${error.message})` : undefined,
      );
    });

    const timer = setTimeout(() => {
      settle(`The response didn't finish within ${timeoutMs / 1000} seconds`);
      body.destroy();
    }, timeoutMs);
  });
}
