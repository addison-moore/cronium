/**
 * In-process execution for HTTP_REQUEST events.
 *
 * Like tool actions, HTTP request events have no script, so the orchestrator
 * (container/ssh only) rejected them as scriptless container jobs. They are just
 * outbound HTTP calls, and the app already has a low-level `executeHttpRequest`
 * (axios). This wraps it at the event level: it interpolates `${cronium.input.*}`
 * and user variables into the URL / body / header values (the same templating
 * script and tool-action events get), runs the request, and returns a normalized
 * result the in-process job runner can finalize.
 *
 * Note (self-hosted threat model): an HTTP_REQUEST event calls a user-configured
 * URL, so this runs from the app process rather than an isolated container. In a
 * single-tenant self-hosted deployment the operator is the author of their own
 * events; we intentionally do not restrict destinations (unlike tool webhooks,
 * which are host-allowlisted) so legitimate internal endpoints keep working.
 */
import { storage } from "@/server/storage";
import {
  createTemplateContext,
  templateProcessor,
} from "@/lib/template-processor";
import { executeHttpRequest } from "./http-executor";
import type { Event } from "@/shared/schema";

export interface InProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  data?: unknown;
}

interface HttpHeader {
  key: string;
  value: string;
}

export async function executeHttpEvent(
  event: Event,
  input: Record<string, unknown> = {},
): Promise<InProcessResult> {
  if (!event.httpUrl) {
    return {
      stdout: "",
      stderr: "HTTP request event has no URL configured",
      exitCode: 1,
    };
  }

  // Interpolate variables/input into the request, matching script and
  // tool-action events. If the context can't be built, fall back to raw values.
  let process = (value: string): string => value;
  try {
    const userVariables = await storage.getUserVariables(event.userId);
    const variablesMap: Record<string, unknown> = {};
    userVariables.forEach((variable) => {
      variablesMap[variable.key] = variable.value;
    });
    const context = createTemplateContext(
      {
        id: event.id,
        name: event.name,
        status: "running",
        duration: 0,
        executionTime: new Date().toISOString(),
        server: event.serverId ? `server-${event.serverId}` : "local",
        output: "",
      },
      { ...variablesMap, ...input },
      input,
      {},
    );
    process = (value: string) =>
      templateProcessor.processTemplate(value, context);
  } catch (err) {
    console.warn(
      "[HttpEvent] Template context unavailable; using raw request values:",
      err,
    );
  }

  const method = (event.httpMethod ?? "GET").toUpperCase();
  const url = process(event.httpUrl);
  const rawHeaders: HttpHeader[] = Array.isArray(event.httpHeaders)
    ? (event.httpHeaders as HttpHeader[])
    : [];
  const headers = rawHeaders
    .filter((h) => h?.key)
    .map((h) => ({ key: h.key, value: process(String(h.value ?? "")) }));
  const body = event.httpBody ? process(event.httpBody) : null;

  const { data, error } = await executeHttpRequest(method, url, headers, body);
  const status = data?.status ?? 0;
  const succeeded = !error && status >= 200 && status < 400;

  const summary = {
    method,
    url,
    status,
    statusText: data?.statusText,
    body: data?.body,
  };

  return {
    stdout: JSON.stringify(summary, null, 2),
    stderr: succeeded
      ? ""
      : (error ?? `HTTP request failed with status ${status}`),
    exitCode: succeeded ? 0 : 1,
    data,
  };
}
