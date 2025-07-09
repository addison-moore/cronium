import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for create-meeting action parameters
export const createMeetingSchema = z.object({
  subject: z.string().min(1).describe("The subject/title of the meeting"),
  startDateTime: z
    .string()
    .describe("Start time in ISO 8601 format (e.g., 2024-01-15T10:00:00Z)"),
  endDateTime: z
    .string()
    .describe("End time in ISO 8601 format (e.g., 2024-01-15T11:00:00Z)"),
  attendees: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().optional(),
        type: z
          .enum(["required", "optional", "resource"])
          .optional()
          .default("required"),
      }),
    )
    .describe("List of meeting attendees"),
  location: z
    .string()
    .optional()
    .describe("Physical location or 'Microsoft Teams Meeting'"),
  body: z
    .object({
      contentType: z.enum(["html", "text"]).optional().default("html"),
      content: z.string(),
    })
    .optional()
    .describe("Meeting description/agenda"),
  isOnlineMeeting: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether this is an online Teams meeting"),
  allowNewTimeProposals: z
    .boolean()
    .optional()
    .default(true)
    .describe("Allow attendees to propose new times"),
  reminderMinutesBeforeStart: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(15)
    .describe("Reminder time in minutes"),
  categories: z
    .array(z.string())
    .optional()
    .describe("Categories to assign to the meeting"),
});

export type CreateMeetingParams = z.infer<typeof createMeetingSchema>;

export const createMeetingAction: ToolAction = {
  id: "create-meeting",
  name: "Create Meeting",
  description: "Create a Microsoft Teams meeting (requires OAuth)",
  category: "Calendar",
  actionType: "create",
  developmentMode: "visual",
  inputSchema: createMeetingSchema,
  parameters: zodToParameters(createMeetingSchema),
  outputSchema: z.object({
    success: z.boolean(),
    meetingId: z.string().optional(),
    joinUrl: z.string().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Simple Team Meeting",
      description: "Create a basic Teams meeting",
      input: {
        subject: "Weekly Team Sync",
        startDateTime: "2024-01-15T10:00:00Z",
        endDateTime: "2024-01-15T11:00:00Z",
        attendees: [
          { email: "john.doe@example.com", name: "John Doe" },
          { email: "jane.smith@example.com", name: "Jane Smith" },
        ],
        isOnlineMeeting: true,
      },
      output: {
        success: true,
        meetingId: "AAMkAGI1AAA=",
        joinUrl: "https://teams.microsoft.com/l/meetup-join/...",
      },
    },
    {
      name: "Meeting with Agenda",
      description: "Create a meeting with detailed agenda",
      input: {
        subject: "Q1 Planning Session",
        startDateTime: "2024-01-20T14:00:00Z",
        endDateTime: "2024-01-20T16:00:00Z",
        attendees: [
          { email: "manager@example.com", name: "Manager", type: "required" },
          { email: "team@example.com", name: "Team", type: "required" },
          {
            email: "stakeholder@example.com",
            name: "Stakeholder",
            type: "optional",
          },
        ],
        location: "Microsoft Teams Meeting",
        body: {
          contentType: "html",
          content: `<h2>Q1 Planning Agenda</h2>
            <ul>
              <li>Review Q4 results (30 min)</li>
              <li>Q1 objectives and key results (45 min)</li>
              <li>Resource allocation (30 min)</li>
              <li>Questions and discussion (15 min)</li>
            </ul>
            <p>Please review the attached documents before the meeting.</p>`,
        },
        categories: ["Planning", "Quarterly"],
      },
      output: {
        success: true,
        meetingId: "AAMkAGI2BBB=",
        joinUrl: "https://teams.microsoft.com/l/meetup-join/...",
      },
    },
    {
      name: "Recurring Meeting",
      description: "Create a recurring daily standup",
      input: {
        subject: "Daily Standup",
        startDateTime: "2024-01-15T09:00:00Z",
        endDateTime: "2024-01-15T09:15:00Z",
        attendees: [
          { email: "dev1@example.com", name: "Developer 1" },
          { email: "dev2@example.com", name: "Developer 2" },
          { email: "dev3@example.com", name: "Developer 3" },
        ],
        body: {
          contentType: "text",
          content:
            "Daily standup meeting\n- What did you do yesterday?\n- What will you do today?\n- Any blockers?",
        },
        reminderMinutesBeforeStart: 5,
      },
      output: {
        success: true,
        meetingId: "AAMkAGI3CCC=",
        joinUrl: "https://teams.microsoft.com/l/meetup-join/...",
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as CreateMeetingParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing meeting details...", percentage: 10 });
      }

      // Check for OAuth token
      const oauthToken = (credentials as { oauthToken?: string }).oauthToken;
      if (!oauthToken) {
        throw new Error(
          "OAuth authentication required. This action requires Microsoft Graph API access with Calendar.ReadWrite permissions.",
        );
      }

      // Replace variables in parameters
      const subject = replaceVariables(typedParams.subject, variables);
      const startDateTime = replaceVariables(
        typedParams.startDateTime,
        variables,
      );
      const endDateTime = replaceVariables(typedParams.endDateTime, variables);

      // Build meeting object
      const meeting: Record<string, unknown> = {
        subject,
        start: {
          dateTime: startDateTime,
          timeZone: "UTC",
        },
        end: {
          dateTime: endDateTime,
          timeZone: "UTC",
        },
        attendees: typedParams.attendees.map((attendee) => ({
          emailAddress: {
            address: replaceVariables(attendee.email, variables),
            name: attendee.name
              ? replaceVariables(attendee.name, variables)
              : undefined,
          },
          type: attendee.type,
        })),
        isOnlineMeeting: typedParams.isOnlineMeeting,
        allowNewTimeProposals: typedParams.allowNewTimeProposals,
        reminderMinutesBeforeStart: typedParams.reminderMinutesBeforeStart,
      };

      if (typedParams.location) {
        meeting.location = {
          displayName: replaceVariables(typedParams.location, variables),
        };
      }

      if (typedParams.body) {
        meeting.body = {
          contentType: typedParams.body.contentType,
          content: replaceVariables(typedParams.body.content, variables),
        };
      }

      if (typedParams.categories) {
        meeting.categories = typedParams.categories;
      }

      logger.info(`Creating Teams meeting with subject: ${subject}`);

      if (isTest) {
        // Test mode - simulate creation
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating meeting creation...",
            percentage: 50,
          });
        }

        // Simulate API delay
        await new Promise((resolve) => setTimeout(resolve, 1500));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          meetingId: "TEST-MEETING-ID",
          joinUrl: "https://teams.microsoft.com/l/meetup-join/TEST",
        };
      }

      // Update progress
      if (onProgress) {
        onProgress({
          step: "Calling Microsoft Graph API...",
          percentage: 30,
        });
      }

      // Create meeting via Microsoft Graph API
      const response = await fetch(
        "https://graph.microsoft.com/v1.0/me/events",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${oauthToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(meeting),
        },
      );

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 70 });
      }

      const data = (await response.json()) as {
        id?: string;
        onlineMeeting?: { joinUrl?: string };
        error?: { message?: string };
      };

      if (!response.ok) {
        const errorMessage =
          data.error?.message ?? `API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Meeting created successfully!", percentage: 100 });
      }

      logger.info(
        `Teams meeting created successfully - Meeting ID: ${data.id}`,
      );

      return {
        success: true,
        meetingId: data.id,
        joinUrl: data.onlineMeeting?.joinUrl,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Teams create meeting error: ${errorMessage}`);
      if (onProgress) {
        onProgress({ step: `Failed: ${errorMessage}`, percentage: 100 });
      }
      return {
        success: false,
        error: errorMessage,
      };
    }
  },
};

// Helper function to replace variables in text
function replaceVariables(
  text: string,
  variables: { get: (key: string) => unknown },
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = variables.get(key);
    if (value === null || value === undefined) return match;
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    // At this point, value is a primitive (string, number, boolean)
    return String(value);
  });
}
