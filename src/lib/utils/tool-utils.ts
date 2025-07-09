/**
 * Utility functions for tool-related operations
 */

/**
 * Format tool type for display
 * Converts ALL_CAPS to Proper Case
 * @param toolType - The tool type (e.g., "DISCORD", "SLACK", "EMAIL")
 * @returns Formatted tool name (e.g., "Discord", "Slack", "Email")
 */
export function formatToolName(toolType: string): string {
  // Special cases for proper names
  const specialCases: Record<string, string> = {
    TEAMS: "Microsoft Teams",
    GOOGLE_SHEETS: "Google Sheets",
    GITHUB: "GitHub",
    GITLAB: "GitLab",
  };

  if (specialCases[toolType]) {
    return specialCases[toolType];
  }

  // Convert to proper case
  return toolType
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format action ID for display
 * Converts kebab-case to Title Case
 * @param actionId - The action ID (e.g., "send-message", "create-issue")
 * @returns Formatted action name (e.g., "Send Message", "Create Issue")
 */
export function formatActionName(actionId: string): string {
  return actionId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Get badge variant based on action type
 * @param actionType - The action type (e.g., "message", "create", "update")
 * @returns Badge variant for consistent styling
 */
export function getActionTypeBadgeVariant(
  actionType: string,
): "default" | "secondary" | "outline" | "destructive" {
  const variants: Record<
    string,
    "default" | "secondary" | "outline" | "destructive"
  > = {
    message: "default",
    create: "secondary",
    update: "outline",
    delete: "destructive",
    query: "secondary",
    send: "default",
  };

  return variants[actionType] ?? "secondary";
}

/**
 * Get color class for action type badges
 * @param actionType - The action type
 * @returns Tailwind color classes
 */
export function getActionTypeColorClass(actionType: string): string {
  const colors: Record<string, string> = {
    message: "bg-blue-500 text-white",
    create: "bg-green-500 text-white",
    update: "bg-yellow-500 text-white",
    delete: "bg-red-500 text-white",
    query: "bg-purple-500 text-white",
    send: "bg-blue-500 text-white",
  };

  return colors[actionType] ?? "bg-gray-500 text-white";
}
