import { JobSource, JobStatus, JobType } from "./schema";

/**
 * The jobs page's filters, as its address carries them:
 * `/dashboard/jobs?status=…&type=…&search=…`.
 *
 * The page reads them on every load and asks the server for only those jobs, so a
 * reload, Back, or a shared link shows the same list and the same controls. A value
 * it doesn't recognise is ignored rather than passed on, so a hand-edited address
 * can't break the page: the controls then show what the list is really filtered by.
 */

/**
 * The longest search the page sends, and `jobs.list` takes. A job id is at most 50
 * characters and an event id at most 10 digits, so cutting a longer search to this
 * length can't change what it finds: nothing.
 */
export const JOB_SEARCH_MAX_LENGTH = 100;

/** Every `JobStatus`, in the order a job passes through them. */
export const JOB_STATUS_OPTIONS = [
  { value: JobStatus.QUEUED, label: "Queued" },
  { value: JobStatus.CLAIMED, label: "Claimed" },
  { value: JobStatus.RUNNING, label: "Running" },
  { value: JobStatus.COMPLETED, label: "Completed" },
  { value: JobStatus.FAILED, label: "Failed" },
  { value: JobStatus.TIMED_OUT, label: "Timed out" },
  { value: JobStatus.CANCELLED, label: "Cancelled" },
] as const;

/**
 * Every `JobType`, and Workflow. Workflow isn't a job type: a workflow runs each of
 * its steps as a job of that step's own type. It's where a job came from, so it
 * filters on `source`, and a workflow's script step is under Script as well.
 */
export const JOB_TYPE_OPTIONS = [
  { value: "script", label: "Script", filter: { type: JobType.SCRIPT } },
  { value: "http", label: "HTTP", filter: { type: JobType.HTTP_REQUEST } },
  {
    value: "tool",
    label: "Tool Action",
    filter: { type: JobType.TOOL_ACTION },
  },
  {
    value: "workflow",
    label: "Workflow",
    filter: { source: JobSource.WORKFLOW_STEP },
  },
] as const;

export type JobStatusFilter = (typeof JOB_STATUS_OPTIONS)[number]["value"];
export type JobTypeFilter = (typeof JOB_TYPE_OPTIONS)[number]["value"];

export interface JobListFilters {
  /** Trimmed; "" for no search. */
  search: string;
  status: JobStatusFilter | "all";
  type: JobTypeFilter | "all";
}

export const NO_JOB_FILTERS: JobListFilters = {
  search: "",
  status: "all",
  type: "all",
};

/** What Next passes a page as `searchParams`. */
export type JobListSearchParams = Record<string, string | string[] | undefined>;

/** A repeated parameter counts once, as `URLSearchParams.get` reads it. */
function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseJobListFilters(
  params: JobListSearchParams,
): JobListFilters {
  const status = firstValue(params.status).trim().toLowerCase();
  const type = firstValue(params.type).trim().toLowerCase();
  return {
    search: firstValue(params.search)
      .trim()
      .slice(0, JOB_SEARCH_MAX_LENGTH)
      .trim(),
    status:
      JOB_STATUS_OPTIONS.find((option) => String(option.value) === status)
        ?.value ?? "all",
    type:
      JOB_TYPE_OPTIONS.find((option) => option.value === type)?.value ?? "all",
  };
}

/**
 * The query string for these filters, without the `?`: what Apply Filters goes to,
 * and "" when nothing is filtered. The page also keys the list and the controls on
 * it, so they start again whenever the address's filters change.
 */
export function jobListQuery(filters: JobListFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.type !== "all") params.set("type", filters.type);
  const search = filters.search.trim();
  if (search) params.set("search", search);
  return params.toString();
}

/** The `jobs.list` filters that give the page's list for these filters. */
export function jobListInput(filters: JobListFilters): {
  status?: JobStatus;
  type?: JobType;
  source?: JobSource;
  search?: string;
} {
  const typeOption = JOB_TYPE_OPTIONS.find(
    (option) => option.value === filters.type,
  );
  const search = filters.search.trim();
  return {
    ...(filters.status !== "all" && { status: filters.status }),
    ...typeOption?.filter,
    ...(search && { search }),
  };
}
