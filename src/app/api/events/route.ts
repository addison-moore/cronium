import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { EventType, EventStatus, RunLocation, TimeUnit } from "@/shared/schema";
import { z } from "zod";
import { authenticateApiRequest } from "@/lib/api-auth";

// Schema for validating new script input
const createEventSchema = z
  .object({
    name: z.string().min(1, { message: "Script name is required" }),
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
    scheduleNumber: z.number().min(1).optional(),
    scheduleUnit: z.enum([
      TimeUnit.SECONDS,
      TimeUnit.MINUTES,
      TimeUnit.HOURS,
      TimeUnit.DAYS,
    ]),
    customSchedule: z.string().optional(),
    // Add start time field - can be string ISO date or null
    startTime: z.union([z.string(), z.null(), z.undefined()]),
    runLocation: z.enum([RunLocation.LOCAL, RunLocation.REMOTE]),
    // Allow serverId to be null, undefined, or a number
    serverId: z.union([z.number(), z.null(), z.undefined()]),
    // Support multiple servers
    selectedServerIds: z.array(z.number()).optional(),
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
    onSuccessActions: z
      .array(
        z.object({
          type: z.string(),
          value: z.string().optional(),
          targetScriptId: z.union([z.number(), z.null()]).optional(),
        }),
      )
      .optional(),
    onFailActions: z
      .array(
        z.object({
          type: z.string(),
          value: z.string().optional(),
          targetScriptId: z.union([z.number(), z.null()]).optional(),
        }),
      )
      .optional(),
  })
  .refine(
    (data) => {
      // For HTTP_REQUEST type, require httpUrl and httpMethod
      if (data.type === EventType.HTTP_REQUEST) {
        return !!data.httpUrl && !!data.httpMethod;
      }
      // For all other script types, require content
      return !!data.content;
    },
    {
      message: "Required fields are missing for the selected script type",
      path: ["type"],
    },
  );

// Helper function to authenticate user via session or API token
async function authenticateUser(
  request: NextRequest,
): Promise<{ userId: string } | null> {
  // First try API token
  const apiAuth = await authenticateApiRequest(request);

  if (apiAuth.authenticated && apiAuth.userId) {
    return { userId: apiAuth.userId };
  }

  // Check if this is an API request (has Authorization header or is accessing /api/ endpoints)
  const authHeader = request.headers.get("Authorization");
  const isApiRequest = authHeader !== null || request.url.includes("/api/");

  // For session authentication, we need to properly handle cookies
  const headers = new Headers();
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  try {
    // Try to get session with proper request context
    const session = await getServerSession({
      ...authOptions,
      callbacks: {
        ...authOptions.callbacks,
        session: async ({ session, token }) => {
          if (token?.id && session?.user) {
            session.user.id = token.id as string;
          }
          return session;
        },
      },
    });

    if (session?.user?.id) {
      return { userId: session.user.id };
    }
  } catch (error) {
    console.log("Session auth failed:", error);
  }

  // Only use fallback for browser requests (no Authorization header)
  // API requests should fail with 401 if no valid auth is provided
  if (!isApiRequest) {
    try {
      const allUsers = await storage.getAllUsers();
      if (allUsers.length > 0) {
        // Use the first admin user for development browser sessions
        const adminUser =
          allUsers.find((u) => u.role === "ADMIN") || allUsers[0];
        if (!adminUser) {
          throw new Error("No admin user found for development session");
        }
        return { userId: adminUser.id };
      }
    } catch (error) {
      console.error("Fallback user lookup failed:", error);
    }
  }

  // No authentication found
  return null;
}

// GET all scripts for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      console.log("Authentication failed in events API");
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Fetching events for user: ${auth.userId}`);

    // Get all scripts for this user
    const events = await storage.getAllEvents(auth.userId);

    console.log(`Found ${events.length} events for user ${auth.userId}`);

    return NextResponse.json(events);
  } catch (error) {
    console.error("Error fetching scripts:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// POST to create a new script
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();

    // Validate input
    const validationResult = createEventSchema.safeParse(body);

    if (!validationResult.success) {
      console.error(
        "Validation error details:",
        JSON.stringify(validationResult.error.format(), null, 2),
      );

      return new NextResponse(
        JSON.stringify({
          error: "Validation error",
          details: validationResult.error.format(),
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Log the validated data for debugging
    console.log(
      "Valid event data:",
      JSON.stringify(validationResult.data, null, 2),
    );

    const data = validationResult.data;

    // Create the script
    const scriptData: any = {
      userId: auth.userId,
      name: data.name,
      type: data.type,
      status: data.status,
      scheduleNumber: data.scheduleNumber || 1,
      scheduleUnit: data.scheduleUnit,
      customSchedule: data.customSchedule,
      // Handle the start time field - ensure it's a valid Date or null
      startTime: data.startTime ? new Date(data.startTime) : null,
      runLocation: data.runLocation,
      serverId: data.serverId,
      timeoutValue: data.timeoutValue,
      timeoutUnit: data.timeoutUnit,
      retries: data.retries,
    };

    // Handle serverId properly based on runLocation
    if (scriptData.runLocation === RunLocation.LOCAL) {
      scriptData.serverId = null;
    }

    // Add type-specific fields
    if (data.type === EventType.HTTP_REQUEST) {
      // Check if we have the new format httpRequest field
      if (body.httpRequest && typeof body.httpRequest === "string") {
        try {
          const httpRequestData = JSON.parse(body.httpRequest);
          scriptData.httpMethod = httpRequestData.method;
          scriptData.httpUrl = httpRequestData.url;
          scriptData.httpBody = httpRequestData.body || "";
          scriptData.httpHeaders = JSON.stringify(
            httpRequestData.headers || [],
          );
        } catch (parseError) {
          console.error("Error parsing HTTP request data:", parseError);
          // Fall back to the old format
          scriptData.httpMethod = data.httpMethod;
          scriptData.httpUrl = data.httpUrl;
          scriptData.httpBody = data.httpBody || "";

          // Add HTTP headers if provided
          if (data.httpHeaders && data.httpHeaders.length > 0) {
            scriptData.httpHeaders = JSON.stringify(data.httpHeaders);
          } else {
            scriptData.httpHeaders = JSON.stringify([]);
          }
        }
      } else {
        // Use the old format
        scriptData.httpMethod = data.httpMethod;
        scriptData.httpUrl = data.httpUrl;
        scriptData.httpBody = data.httpBody || "";

        // Add HTTP headers if provided
        if (data.httpHeaders && data.httpHeaders.length > 0) {
          scriptData.httpHeaders = JSON.stringify(data.httpHeaders);
        } else {
          scriptData.httpHeaders = JSON.stringify([]);
        }
      }

      // For HTTP requests, we still need to set content to an empty string
      // to satisfy database constraints
      scriptData.content = "";
    } else {
      scriptData.content = data.content || "";

      // For non-HTTP requests, ensure HTTP fields are null/empty
      scriptData.httpMethod = null;
      scriptData.httpUrl = null;
      scriptData.httpBody = null;
      scriptData.httpHeaders = null;
    }

    const script = await storage.createScript(scriptData);

    // Add environment variables if provided
    if (data.envVars && data.envVars.length > 0) {
      for (const envVar of data.envVars) {
        await storage.createEnvVar({
          eventId: script.id,
          key: envVar.key,
          value: envVar.value,
        });
      }
    }

    // Handle conditional actions
    if (body.conditionalActions && body.conditionalActions.length > 0) {
      for (const condAction of body.conditionalActions) {
        const eventData: any = {
          type: condAction.action,
          value: condAction.details.emailAddresses || "",
          targetEventId: condAction.details.targetEventId || null,
          toolId: condAction.details.toolId || null,
          message: condAction.details.message || null,
          emailAddresses: condAction.details.emailAddresses || null,
          emailSubject: condAction.details.emailSubject || null,
        };

        if (condAction.type === "ON_SUCCESS") {
          eventData.successEventId = script.id;
          await storage.createAction(eventData);
        } else if (condAction.type === "ON_FAILURE") {
          eventData.failEventId = script.id;
          await storage.createAction(eventData);
        } else if (condAction.type === "ALWAYS") {
          eventData.alwaysEventId = script.id;
          await storage.createAction(eventData);
        } else if (condAction.type === "ON_CONDITION") {
          eventData.conditionEventId = script.id;
          await storage.createAction(eventData);
        }
      }
    }

    // Add success events if provided (legacy support)
    if (data.onSuccessActions && data.onSuccessActions.length > 0) {
      for (const action of data.onSuccessActions) {
        await storage.createAction({
          type: action.type as any,
          value: action.value,
          successEventId: script.id,
          targetEventId: action.targetScriptId,
        });
      }
    }

    // Add failure events if provided (legacy support)
    if (data.onFailActions && data.onFailActions.length > 0) {
      for (const action of data.onFailActions) {
        await storage.createAction({
          type: action.type as any,
          value: action.value,
          failEventId: script.id,
          targetEventId: action.targetScriptId,
        });
      }
    }

    // Handle multiple server selection for remote events
    if (data.selectedServerIds && data.selectedServerIds.length > 0) {
      await storage.setEventServers(script.id, data.selectedServerIds);
    }

    // Get the full script with all relations
    const fullScript = await storage.getEventWithRelations(script.id);

    return NextResponse.json(fullScript, { status: 201 });
  } catch (error) {
    console.error("Error creating script:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
