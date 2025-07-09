import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for manage-team action parameters
export const manageTeamSchema = z.object({
  operation: z
    .enum([
      "create-team",
      "add-member",
      "remove-member",
      "create-channel",
      "archive-team",
    ])
    .describe("The operation to perform"),
  teamId: z
    .string()
    .optional()
    .describe("The ID of the team (required for most operations)"),
  teamName: z
    .string()
    .optional()
    .describe("Name of the team (required for create-team)"),
  description: z.string().optional().describe("Team or channel description"),
  visibility: z
    .enum(["private", "public"])
    .optional()
    .default("private")
    .describe("Team visibility"),
  memberEmail: z
    .string()
    .email()
    .optional()
    .describe("Email of member to add/remove"),
  memberRole: z
    .enum(["member", "owner"])
    .optional()
    .default("member")
    .describe("Role for the member"),
  channelName: z.string().optional().describe("Name of the channel to create"),
  channelDescription: z
    .string()
    .optional()
    .describe("Description of the channel"),
  membershipType: z
    .enum(["standard", "private", "shared"])
    .optional()
    .default("standard")
    .describe("Type of channel membership"),
});

export type ManageTeamParams = z.infer<typeof manageTeamSchema>;

export const manageTeamAction: ToolAction = {
  id: "manage-team",
  name: "Manage Team",
  description: "Manage Microsoft Teams teams and channels (requires OAuth)",
  category: "Team Management",
  actionType: "update",
  developmentMode: "visual",
  inputSchema: manageTeamSchema,
  parameters: zodToParameters(manageTeamSchema),
  outputSchema: z.object({
    success: z.boolean(),
    teamId: z.string().optional(),
    channelId: z.string().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Create Team",
      description: "Create a new Microsoft Teams team",
      input: {
        operation: "create-team",
        teamName: "Project Phoenix",
        description: "Team for Project Phoenix development",
        visibility: "private",
      },
      output: {
        success: true,
        teamId: "57fb72d0-d811-46f4-8947-305e6072eaa5",
      },
    },
    {
      name: "Add Team Member",
      description: "Add a member to an existing team",
      input: {
        operation: "add-member",
        teamId: "57fb72d0-d811-46f4-8947-305e6072eaa5",
        memberEmail: "john.doe@example.com",
        memberRole: "member",
      },
      output: {
        success: true,
      },
    },
    {
      name: "Create Channel",
      description: "Create a new channel in a team",
      input: {
        operation: "create-channel",
        teamId: "57fb72d0-d811-46f4-8947-305e6072eaa5",
        channelName: "frontend-dev",
        channelDescription: "Frontend development discussions",
        membershipType: "standard",
      },
      output: {
        success: true,
        channelId: "19:561082c0f3f847a58069deb8eb300807@thread.tacv2",
      },
    },
    {
      name: "Remove Member",
      description: "Remove a member from a team",
      input: {
        operation: "remove-member",
        teamId: "57fb72d0-d811-46f4-8947-305e6072eaa5",
        memberEmail: "john.doe@example.com",
      },
      output: {
        success: true,
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as ManageTeamParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing team operation...", percentage: 10 });
      }

      // Check for OAuth token
      const oauthToken = (credentials as { oauthToken?: string }).oauthToken;
      if (!oauthToken) {
        throw new Error(
          "OAuth authentication required. This action requires Microsoft Graph API access with Team.ReadWrite.All permissions.",
        );
      }

      logger.info(`Performing team operation: ${typedParams.operation}`);

      if (isTest) {
        // Test mode - simulate operation
        if (onProgress) {
          onProgress({
            step: `Test mode - simulating ${typedParams.operation}...`,
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        let result: {
          success: boolean;
          teamId?: string;
          channelId?: string;
        } = {
          success: true,
        };

        if (typedParams.operation === "create-team") {
          result = { ...result, teamId: "TEST-TEAM-ID" };
        } else if (typedParams.operation === "create-channel") {
          result = { ...result, channelId: "TEST-CHANNEL-ID" };
        }

        return result;
      }

      let response: Response;
      let result: {
        success: boolean;
        teamId?: string;
        channelId?: string;
        error?: string;
      } = { success: false };

      // Update progress
      if (onProgress) {
        onProgress({
          step: "Calling Microsoft Graph API...",
          percentage: 30,
        });
      }

      switch (typedParams.operation) {
        case "create-team": {
          const teamName = replaceVariables(
            typedParams.teamName ?? "",
            variables,
          );
          const description = typedParams.description
            ? replaceVariables(typedParams.description, variables)
            : undefined;

          const teamData = {
            "template@odata.bind":
              "https://graph.microsoft.com/v1.0/teamsTemplates('standard')",
            displayName: teamName,
            description,
            visibility: typedParams.visibility,
          };

          response = await fetch("https://graph.microsoft.com/v1.0/teams", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${oauthToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(teamData),
          });

          if (response.status === 202) {
            // Team creation is async, get the operation location
            const location = response.headers.get("Location");
            if (location) {
              // Extract team ID from location header
              const match = /teams\('([^']+)'\)/.exec(location);
              if (match?.[1]) {
                result = { success: true, teamId: match[1] };
              }
            }
          }
          break;
        }

        case "add-member": {
          if (!typedParams.teamId) {
            throw new Error("Team ID is required for add-member operation");
          }
          if (!typedParams.memberEmail) {
            throw new Error(
              "Member email is required for add-member operation",
            );
          }

          const memberData = {
            "@odata.type": "#microsoft.graph.aadUserConversationMember",
            "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${replaceVariables(
              typedParams.memberEmail,
              variables,
            )}')`,
            roles: typedParams.memberRole === "owner" ? ["owner"] : [],
          };

          response = await fetch(
            `https://graph.microsoft.com/v1.0/teams/${typedParams.teamId}/members`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${oauthToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(memberData),
            },
          );

          if (response.ok) {
            result = { success: true };
          }
          break;
        }

        case "remove-member": {
          if (!typedParams.teamId) {
            throw new Error("Team ID is required for remove-member operation");
          }
          if (!typedParams.memberEmail) {
            throw new Error(
              "Member email is required for remove-member operation",
            );
          }

          // First, get the member ID
          const memberEmail = replaceVariables(
            typedParams.memberEmail,
            variables,
          );
          const membersResponse = await fetch(
            `https://graph.microsoft.com/v1.0/teams/${typedParams.teamId}/members`,
            {
              headers: {
                Authorization: `Bearer ${oauthToken}`,
              },
            },
          );

          const membersData = (await membersResponse.json()) as {
            value?: Array<{ id?: string; email?: string }>;
          };
          const member = membersData.value?.find(
            (m) => m.email === memberEmail,
          );

          if (member?.id) {
            response = await fetch(
              `https://graph.microsoft.com/v1.0/teams/${typedParams.teamId}/members/${member.id}`,
              {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${oauthToken}`,
                },
              },
            );

            if (response.status === 204) {
              result = { success: true };
            }
          } else {
            throw new Error("Member not found in team");
          }
          break;
        }

        case "create-channel": {
          if (!typedParams.teamId) {
            throw new Error("Team ID is required for create-channel operation");
          }
          if (!typedParams.channelName) {
            throw new Error(
              "Channel name is required for create-channel operation",
            );
          }

          const channelData = {
            displayName: replaceVariables(typedParams.channelName, variables),
            description: typedParams.channelDescription
              ? replaceVariables(typedParams.channelDescription, variables)
              : undefined,
            membershipType: typedParams.membershipType,
          };

          response = await fetch(
            `https://graph.microsoft.com/v1.0/teams/${typedParams.teamId}/channels`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${oauthToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(channelData),
            },
          );

          if (response.ok) {
            const data = (await response.json()) as { id?: string };
            result = { success: true, ...(data.id && { channelId: data.id }) };
          }
          break;
        }

        case "archive-team": {
          if (!typedParams.teamId) {
            throw new Error("Team ID is required for archive-team operation");
          }

          response = await fetch(
            `https://graph.microsoft.com/v1.0/teams/${typedParams.teamId}/archive`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${oauthToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                shouldSetSpoSiteReadOnlyForMembers: true,
              }),
            },
          );

          if (response.status === 202) {
            result = { success: true };
          }
          break;
        }

        default:
          throw new Error(`Unknown operation: ${typedParams.operation}`);
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 80 });
      }

      if (!result.success && response!) {
        const errorData = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(
          errorData.error?.message ?? `API error: ${response.status}`,
        );
      }

      // Update progress
      if (onProgress) {
        onProgress({
          step: "Operation completed successfully!",
          percentage: 100,
        });
      }

      logger.info("Teams operation completed successfully");
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Teams manage operation error: ${errorMessage}`);
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
