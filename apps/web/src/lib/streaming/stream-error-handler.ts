// import { NextResponse } from "next/server";

export interface StreamErrorOptions {
  maxRetries?: number;
  retryDelay?: number;
  onError?: (error: Error, attempt: number) => void;
  fallbackData?: unknown;
}

export class StreamErrorHandler {
  private retryCount = 0;
  private maxRetries: number;
  private retryDelay: number;
  private onError?: (error: Error, attempt: number) => void;
  private fallbackData?: unknown;

  constructor(options: StreamErrorOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelay = options.retryDelay ?? 1000;
    if (options.onError) {
      this.onError = options.onError;
    }
    this.fallbackData = options.fallbackData;
  }

  async withRetry<T>(
    fn: () => Promise<T>,
    context?: string,
  ): Promise<T | null> {
    while (this.retryCount < this.maxRetries) {
      try {
        const result = await fn();
        this.retryCount = 0; // Reset on success
        return result;
      } catch (error) {
        this.retryCount++;
        const err = error as Error;

        console.error(
          `Stream error in ${context ?? "unknown context"} (attempt ${this.retryCount}/${this.maxRetries}):`,
          err.message,
        );

        this.onError?.(err, this.retryCount);

        if (this.retryCount >= this.maxRetries) {
          if (this.fallbackData !== undefined) {
            return this.fallbackData as T;
          }
          throw new Error(
            `Stream failed after ${this.maxRetries} attempts: ${err.message}`,
          );
        }

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      }
    }

    return null;
  }

  reset() {
    this.retryCount = 0;
  }
}

// Utility for creating streaming responses with error handling
export function createStreamingResponse(
  stream: ReadableStream,
  options?: {
    headers?: HeadersInit;
    status?: number;
    onError?: (error: Error) => void;
  },
) {
  const { headers = {}, status = 200, onError } = options ?? {};

  try {
    return new Response(stream, {
      status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...headers,
      },
    });
  } catch (error) {
    onError?.(error as Error);

    // Return error as stream
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({
              error: true,
              message: (error as Error).message,
            })}\n\n`,
          ),
        );
        controller.close();
      },
    });

    return new Response(errorStream, {
      status: 500,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  }
}

// Helper for handling streaming data with automatic retry
export async function* streamWithRetry<T>(
  dataSource: AsyncGenerator<T>,
  options?: StreamErrorOptions,
): AsyncGenerator<T> {
  const handler = new StreamErrorHandler(options);

  try {
    for await (const data of dataSource) {
      yield data;
    }
  } catch (error) {
    console.error("Stream iteration error:", error);

    // Attempt to recover by retrying the entire stream
    const retryResult = await handler.withRetry(async () => {
      const results: T[] = [];
      for await (const data of dataSource) {
        results.push(data);
      }
      return results;
    }, "stream iteration");

    if (retryResult) {
      for (const data of retryResult) {
        yield data;
      }
    }
  }
}

// React Server Component streaming helper
export function withStreamingErrorBoundary<
  T extends (...args: unknown[]) => unknown,
>(
  fn: T,
  options?: {
    fallback?: unknown;
    onError?: (error: Error) => void;
  },
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      const err = error as Error;
      console.error("RSC streaming error:", err);
      options?.onError?.(err);

      if (options?.fallback !== undefined) {
        return options.fallback;
      }

      throw err;
    }
  }) as T;
}
