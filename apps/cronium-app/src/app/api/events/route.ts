import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import {
  EventType,
  EventStatus,
  EventTriggerType,
  RunLocation,
  TimeUnit,
  type InsertEvent,
} from "@/shared/schema";
import { scheduler } from "@/lib/scheduler";
import {
  intervalSecondsFor,
  validateCronExpr,
  validateIntervalSeconds,
} from "@/lib/scheduling/schedule-math";
import { canReadEnvVarValues } from "@/server/token-scopes";
import { z } from "zod";
import {
  authenticateRestPrincipal,
  restPrincipalErrorResponse,
} from "@/lib/api-auth";
import {
  assertProposedEventServers,
  resourceAccessHttpStatus,
} from "@/server/security/resource-access";
import { toEventApiDto, toEventListApiDto } from "@/server/security/api-dto";

// Schema for validating new script input
const createEventSchema = z
  .object({
    name: z
      .string()
      .min(1, { message: "Script name is required" })
      .max(100, { message: "Script name must be less than 100 characters" }),
    description: z.string().optional(),
    shared: z.boolean().default(false),
    tags: z.array(z.string()).optional().default([]),
    type: z.enum([
      EventType.NODEJS,
      EventType.PYTHON,
      EventType.BASH,
      EventType.HTTP_REQUEST,
    ]),
    // Make content optional since it's not needed for HTTP requests
    content: z.string().optional(),
    httpRequest: z.string().optional(),

    // HTTP Request specific fields
    httpMethod: z.string().optional(),
    httpUrl: z.string().optional(),
    httpHeaders: z
      .array(
        z.object({
          key: z.string().min(1),
          value: z.string(),
        }),
      )
      .optional(),
    httpBody: z.string().optional(),

    status: z.enum([EventStatus.ACTIVE, EventStatus.PAUSED, EventStatus.DRAFT]),
    // Optional for compatibility; inferred from the schedule fields when absent.
    triggerType: z.nativeEnum(EventTriggerType).optional(),
    scheduleNumber: z.number().min(1).optional(),
    scheduleUnit: z.enum([
      TimeUnit.SECONDS,
      TimeUnit.MINUTES,
      TimeUnit.HOURS,
      TimeUnit.DAYS,
    ]),
    customSchedule: z.string().optional(),
    // Add start time field - can be string ISO date or null
    startTime: z.string().nullish(),
    runLocation: z.enum([RunLocation.LOCAL, RunLocation.REMOTE]),
    // Allow serverId to be null, undefined, or a number
    serverId: z.number().int().positive().nullish(),
    // Support multiple servers
    selectedServerIds: z.array(z.number().int().positive()).optional(),
    timeoutValue: z.number().min(1),
    timeoutUnit: z.enum([TimeUnit.SECONDS, TimeUnit.MINUTES, TimeUnit.HOURS]),
    retries: z.number().min(0),
    envVars: z
      .array(
        z.object({
          key: z.string().min(1),
          value: z.string(),
        }),
      )
      .optional(),
  })
  .strict()
  .refine(
    (data) => {
      // For HTTP_REQUEST type, require httpUrl and httpMethod
      if (data.type === EventType.HTTP_REQUEST) {
        return (!!data.httpUrl && !!data.httpMethod) || !!data.httpRequest;
      }
      // For all other script types, require content
      return !!data.content;
    },
    {
      message: "Required fields are missing for the selected script type",
      path: ["type"],
    },
  )
  .refine(
    (data) =>
      !data.customSchedule || validateCronExpr(data.customSchedule).valid,
    { message: "Invalid cron expression", path: ["customSchedule"] },
  )
  .refine(
    (data) =>
      Boolean(data.customSchedule) ||
      !data.scheduleNumber ||
      validateIntervalSeconds(
        intervalSecondsFor(data.scheduleNumber, data.scheduleUnit),
      ) === null,
    {
      message: "Intervals below 10 seconds are not supported",
      path: ["scheduleNumber"],
    },
  );

/** The HTTP fields of a new event, from `httpRequest` JSON or the separate fields. */
function httpFieldsFrom(data: z.infer<typeof createEventSchema>): {
  httpMethod: string | null;
  httpUrl: string | null;
  httpBody: string;
  httpHeaders: Array<{ key: string; value: string }>;
} {
  const fallback = {
    httpMethod: data.httpMethod ?? null,
    httpUrl: data.httpUrl ?? null,
    httpBody: data.httpBody ?? "",
    httpHeaders: data.httpHeaders ?? [],
  };
  if (!data.httpRequest) return fallback;
  try {
    const parsed = JSON.parse(data.httpRequest) as {
      method?: string;
      url?: string;
      body?: string;
      headers?: Array<{ key: string; value: string }>;
    };
    return {
      httpMethod: parsed.method ?? fallback.httpMethod,
      httpUrl: parsed.url ?? fallback.httpUrl,
      httpBody: parsed.body ?? fallback.httpBody,
      httpHeaders: parsed.headers ?? fallback.httpHeaders,
    };
  } catch {
    return fallback;
  }
}

// GET all scripts for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRestPrincipal(
      request,
      "view",
      "events.getAll",
    );

    if (!auth.ok) {
      return restPrincipalErrorResponse(auth);
    }

    // Get all scripts for this user
    const events = await storage.getAllEvents(auth.userId);

    return NextResponse.json(
      events.map((event) => toEventListApiDto(event, auth.userId)),
    );
  } catch (error) {
    console.error("Error fetching scripts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST to create a new script
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRestPrincipal(
      request,
      "edit",
      "events.create",
    );

    if (!auth.ok) {
      return restPrincipalErrorResponse(auth);
    }

    const validationResult = createEventSchema.safeParse(await request.json());

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: validationResult.error.format(),
        },
        { status: 400 },
      );
    }

    const data = validationResult.data;
    await assertProposedEventServers(
      auth.userId,
      data.serverId,
      data.selectedServerIds,
    );

    const isHttpRequest = data.type === EventType.HTTP_REQUEST;
    const eventData: InsertEvent = {
      userId: auth.userId,
      name: data.name,
      ...(data.description !== undefined && { description: data.description }),
      shared: data.shared,
      tags: data.tags,
      type: data.type,
      status: data.status,
      // The dispatcher only fires SCHEDULE events, and the column defaults to
      // MANUAL, so a schedule supplied here used to be silently ignored.
      triggerType:
        data.triggerType ??
        (data.customSchedule || data.scheduleNumber
          ? EventTriggerType.SCHEDULE
          : EventTriggerType.MANUAL),
      scheduleNumber: data.scheduleNumber ?? 1,
      scheduleUnit: data.scheduleUnit,
      ...(data.customSchedule ? { customSchedule: data.customSchedule } : {}),
      startTime: data.startTime ? new Date(data.startTime) : null,
      runLocation: data.runLocation,
      serverId:
        data.runLocation === RunLocation.LOCAL ? null : (data.serverId ?? null),
      timeoutValue: data.timeoutValue,
      timeoutUnit: data.timeoutUnit,
      retries: data.retries,
      // Headers stay an array: a JSON-encoded string in this jsonb column reads
      // back as a string, which the HTTP executor drops as "no headers".
      ...(isHttpRequest
        ? { ...httpFieldsFrom(data), content: "" }
        : {
            content: data.content ?? "",
            httpMethod: null,
            httpUrl: null,
            httpBody: null,
            httpHeaders: null,
          }),
    };
    const script = await storage.createScript(eventData, {
      envVars: data.envVars,
      serverIds: data.selectedServerIds,
    });

    // Materialize the schedule, so a new ACTIVE + SCHEDULE event starts firing.
    await scheduler.updateScript(script.id);

    // Get the full script with all relations
    const fullScript = await storage.getEventWithRelations(script.id);

    return NextResponse.json(
      fullScript
        ? toEventApiDto(fullScript, auth.userId, {
            revealEnvVarValues: canReadEnvVarValues(auth.scopes),
          })
        : null,
      { status: 201 },
    );
  } catch (error) {
    console.error(
      "Error creating script:",
      error instanceof Error ? error.message : String(error),
    );
    const accessStatus = resourceAccessHttpStatus(error);
    return NextResponse.json(
      { error: accessStatus ? "Access denied" : "Internal server error" },
      { status: accessStatus ?? 500 },
    );
  }
}
