/**
 * The jobs page's filters as its address carries them. The page used to ignore
 * them, so every filter showed every job; it now reads them through
 * parseJobListFilters and asks jobs.list for jobListInput's filters.
 *
 * @jest-environment node
 */
import {
  JOB_SEARCH_MAX_LENGTH,
  JOB_STATUS_OPTIONS,
  JOB_TYPE_OPTIONS,
  NO_JOB_FILTERS,
  jobListInput,
  jobListQuery,
  parseJobListFilters,
} from "../job-list-filters";
import { JobSource, JobStatus, JobType } from "../schema";

describe("parseJobListFilters", () => {
  it("reads nothing from an address without filters", () => {
    expect(parseJobListFilters({})).toEqual(NO_JOB_FILTERS);
  });

  it("reads each filter the controls write", () => {
    expect(
      parseJobListFilters({
        search: "job_abc",
        status: "failed",
        type: "http",
      }),
    ).toEqual({ search: "job_abc", status: "failed", type: "http" });
  });

  it.each(Object.values(JobStatus))("knows the status %s", (status) => {
    expect(parseJobListFilters({ status }).status).toBe(status);
  });

  it.each(["script", "http", "tool", "workflow"])(
    "knows the type %s",
    (type) => {
      expect(parseJobListFilters({ type }).type).toBe(type);
    },
  );

  it("ignores a status or type it doesn't know, rather than failing", () => {
    expect(
      parseJobListFilters({ status: "exploded", type: "SCRIPTS" }),
    ).toEqual(NO_JOB_FILTERS);
    // The enum's own names aren't the address's words.
    expect(parseJobListFilters({ type: "HTTP_REQUEST" }).type).toBe("all");
    expect(parseJobListFilters({ status: "constructor" }).status).toBe("all");
    expect(parseJobListFilters({ status: "" }).status).toBe("all");
  });

  it("takes a status or type typed in another case", () => {
    expect(parseJobListFilters({ status: "FAILED", type: " Http " })).toEqual({
      search: "",
      status: "failed",
      type: "http",
    });
  });

  it("takes the first of a repeated parameter, as URLSearchParams.get does", () => {
    expect(
      parseJobListFilters({
        status: ["running", "failed"],
        type: ["bogus", "http"],
        search: ["job_a", "job_b"],
      }),
    ).toEqual({ search: "job_a", status: "running", type: "all" });
  });

  it("trims the search, and cuts a long one to what jobs.list takes", () => {
    expect(parseJobListFilters({ search: "  42 \n" }).search).toBe("42");
    const long = parseJobListFilters({ search: "x".repeat(5000) }).search;
    expect(long).toBe("x".repeat(JOB_SEARCH_MAX_LENGTH));
  });
});

describe("jobListQuery", () => {
  it("is empty without filters, so Apply goes to the bare page", () => {
    expect(jobListQuery(NO_JOB_FILTERS)).toBe("");
    expect(jobListQuery({ ...NO_JOB_FILTERS, search: "   " })).toBe("");
  });

  it("writes what parseJobListFilters reads back", () => {
    const filters = {
      search: "job_a%b c",
      status: JobStatus.TIMED_OUT,
      type: "workflow",
    } as const;
    const query = jobListQuery(filters);
    expect(query).toBe("status=timed_out&type=workflow&search=job_a%25b+c");
    expect(
      parseJobListFilters(Object.fromEntries(new URLSearchParams(query))),
    ).toEqual(filters);
  });
});

describe("jobListInput", () => {
  it("asks for every job without filters", () => {
    expect(jobListInput(NO_JOB_FILTERS)).toEqual({});
  });

  it("maps each type to the job type it means", () => {
    const typeOf = (type: (typeof JOB_TYPE_OPTIONS)[number]["value"]) =>
      jobListInput({ ...NO_JOB_FILTERS, type });
    expect(typeOf("script")).toEqual({ type: JobType.SCRIPT });
    expect(typeOf("http")).toEqual({ type: JobType.HTTP_REQUEST });
    expect(typeOf("tool")).toEqual({ type: JobType.TOOL_ACTION });
    // Workflow isn't a job type: a workflow's steps run as jobs of their own
    // types, and the job's source says a workflow started it.
    expect(typeOf("workflow")).toEqual({ source: JobSource.WORKFLOW_STEP });
  });

  it("combines the filters", () => {
    expect(
      jobListInput({ search: " 12 ", status: "completed", type: "script" }),
    ).toEqual({
      status: JobStatus.COMPLETED,
      type: JobType.SCRIPT,
      search: "12",
    });
  });
});

describe("the options", () => {
  it("offer every job status, so none of them is unfilterable", () => {
    expect(JOB_STATUS_OPTIONS.map((option) => option.value).sort()).toEqual(
      Object.values(JobStatus).sort(),
    );
  });

  it("offer every job type", () => {
    const types = JOB_TYPE_OPTIONS.flatMap((option) =>
      "type" in option.filter ? [option.filter.type] : [],
    );
    expect(types.sort()).toEqual(Object.values(JobType).sort());
  });
});
