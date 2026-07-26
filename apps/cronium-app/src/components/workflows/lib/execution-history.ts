/**
 * Pure filtering, sorting, and formatting logic for WorkflowExecutionHistory.
 */
import type { WorkflowExecution } from "@/shared/schema";

export type ExecutionListItem = WorkflowExecution & { workflowName?: string };

export type ExecutionSortKey = "name" | "startedAt" | "completedAt";
export type ExecutionSortOrder = "asc" | "desc";

/** Format a millisecond duration as "1h 2m 3.00s" / "2m 3.00s" / "3.00s"; "N/A" when absent. */
export function formatDuration(duration: number | null): string {
  if (!duration) return "N/A";

  const totalSeconds = duration / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    const remainingSeconds = totalSeconds % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds.toFixed(2)}s`;
  } else if (minutes > 0) {
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
  } else {
    return `${totalSeconds.toFixed(2)}s`;
  }
}

/** Apply the search / status / tag filters of the executions table. */
export function filterExecutions(
  executions: ExecutionListItem[],
  searchTerm: string,
  statusFilter: string,
  tagFilter: string,
): ExecutionListItem[] {
  return executions.filter((execution) => {
    const workflowDisplayName =
      execution.workflowName ?? `Workflow ${String(execution.workflowId)}`;
    const matchesSearch =
      workflowDisplayName?.toLowerCase().includes(searchTerm.toLowerCase()) ??
      true;

    const matchesStatus =
      statusFilter === "all" ||
      String(execution.status) === String(statusFilter);

    // Tags filtering disabled until workflows have tags in schema
    const matchesTag = tagFilter === "all";

    return matchesSearch && matchesStatus && matchesTag;
  });
}

/**
 * Sort executions for the table. When `workflowId` is set (workflow detail
 * page) the "completedAt" key sorts by run duration; otherwise it sorts by
 * completion date.
 */
export function sortExecutions(
  executions: ExecutionListItem[],
  sortBy: ExecutionSortKey,
  sortOrder: ExecutionSortOrder,
  workflowId: number | undefined,
): ExecutionListItem[] {
  return [...executions].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "name":
        comparison = a.workflowId - b.workflowId;
        break;
      case "startedAt":
        comparison =
          new Date(a.startedAt ?? 0).getTime() -
          new Date(b.startedAt ?? 0).getTime();
        break;
      case "completedAt":
        // If we're on a workflow detail page (workflowId exists), sort by duration
        // Otherwise, sort by completion date
        if (workflowId) {
          // Sort by duration (completed - started)
          const aDuration =
            a.completedAt && a.startedAt
              ? new Date(a.completedAt).getTime() -
                new Date(a.startedAt).getTime()
              : 0;
          const bDuration =
            b.completedAt && b.startedAt
              ? new Date(b.completedAt).getTime() -
                new Date(b.startedAt).getTime()
              : 0;
          comparison = aDuration - bDuration;
        } else {
          // Sort by completion date
          const aCompleted = a.completedAt
            ? new Date(a.completedAt).getTime()
            : 0;
          const bCompleted = b.completedAt
            ? new Date(b.completedAt).getTime()
            : 0;
          comparison = aCompleted - bCompleted;
        }
        break;
      default:
        comparison = 0;
    }

    return sortOrder === "asc" ? comparison : -comparison;
  });
}
