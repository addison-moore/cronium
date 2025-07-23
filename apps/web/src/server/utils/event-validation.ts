import { storage } from "@server/storage";
import type { ConditionalAction } from "@shared/schema";
import { ConditionalActionType } from "@shared/schema";

/**
 * Checks if adding a conditional action would create a circular dependency
 * @param eventId The event that would have the conditional action
 * @param targetEventId The event that would be triggered
 * @returns true if circular dependency would be created
 */
export async function hasCircularDependency(
  eventId: number,
  targetEventId: number,
): Promise<boolean> {
  // Direct self-reference
  if (eventId === targetEventId) {
    return true;
  }

  // Check for indirect circular references using DFS
  const visited = new Set<number>();
  const recursionStack = new Set<number>();

  async function dfs(currentEventId: number): Promise<boolean> {
    visited.add(currentEventId);
    recursionStack.add(currentEventId);

    // Get all conditional actions for the current event
    const conditionalActions: ConditionalAction[] =
      await storage.getConditionalActionsByEventId(currentEventId);

    for (const action of conditionalActions) {
      // Only check SCRIPT type actions that have a targetEventId
      if (
        action.type === ConditionalActionType.SCRIPT &&
        action.targetEventId
      ) {
        // If we're trying to add a link to the original event, it's circular
        if (action.targetEventId === eventId) {
          return true;
        }

        // If not visited, recurse
        if (!visited.has(action.targetEventId)) {
          if (await dfs(action.targetEventId)) {
            return true;
          }
        }
        // If in recursion stack, we found a cycle
        else if (recursionStack.has(action.targetEventId)) {
          return true;
        }
      }
    }

    recursionStack.delete(currentEventId);
    return false;
  }

  // Start DFS from the target event to see if it leads back to the source
  return await dfs(targetEventId);
}

/**
 * Validates conditional actions to prevent self-referencing and circular dependencies
 * @param eventId The event being created/updated
 * @param conditionalActions Array of conditional actions to validate
 * @returns Array of validation errors, empty if valid
 */
export async function validateConditionalActions(
  eventId: number,
  conditionalActions: Array<{
    action: string;
    details?: {
      targetEventId?: number;
    };
  }>,
): Promise<string[]> {
  const errors: string[] = [];

  for (const action of conditionalActions) {
    if (action.action === "SCRIPT" && action.details?.targetEventId) {
      // Check for direct self-reference
      if (action.details.targetEventId === eventId) {
        errors.push(
          "An event cannot trigger itself as a conditional action. This would create an infinite loop.",
        );
        continue;
      }

      // Check for circular dependencies
      const hasCircular = await hasCircularDependency(
        eventId,
        action.details.targetEventId,
      );

      if (hasCircular) {
        let eventName = "Unknown";
        try {
          const targetEvent = await storage.getEvent(
            action.details.targetEventId,
          );
          eventName = targetEvent?.name ?? "Unknown";
        } catch (error) {
          // Keep eventName as "Unknown" if there's an error
          console.error("Error fetching target event:", error);
        }
        errors.push(
          `Creating this conditional action would result in a circular dependency. ` +
            `Event "${eventName}" (directly or indirectly) triggers this event, ` +
            `so this event cannot trigger it back.`,
        );
      }
    }
  }

  return errors;
}
