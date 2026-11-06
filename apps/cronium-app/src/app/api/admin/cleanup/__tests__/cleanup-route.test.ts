/**
 * @jest-environment node
 */

// What the route accepts, what it refuses, and what it audits. What cleanupWorkflow
// does to the database is covered against real Postgres in
// tests/storage/workflow-timeout.test.ts.

jest.mock("@/lib/api-auth", () => ({
  authenticateRestPrincipal: jest.fn(() =>
    Promise.resolve({
      ok: true,
      userId: "admin-1",
      role: "ADMIN",
      scopes: null,
    }),
  ),
  restPrincipalErrorResponse: jest.fn(),
}));
jest.mock("@/lib/security/admin-mutation", () => ({
  guardAdminMutation: jest.fn(() => Promise.resolve(null)),
  auditAdminAction: jest.fn(),
}));
jest.mock("@/lib/services/workflow-cleanup-service", () => ({
  getCleanupService: jest.fn(),
}));

import { NextRequest } from "next/server";
import { POST } from "../route";
import { authenticateRestPrincipal } from "@/lib/api-auth";
import {
  auditAdminAction,
  guardAdminMutation,
} from "@/lib/security/admin-mutation";
import { getCleanupService } from "@/lib/services/workflow-cleanup-service";

const audit = auditAdminAction as jest.Mock;
const cleanupWorkflow = jest.fn();
const cleanupJob = jest.fn();
const performCleanup = jest.fn();
const getStuckItemStats = jest.fn();

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost:5001/api/admin/cleanup", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const postRaw = (body: string) =>
  POST(
    new NextRequest("http://localhost:5001/api/admin/cleanup", {
      method: "POST",
      body,
    }),
  );

function expectNothingRan() {
  expect(cleanupWorkflow).not.toHaveBeenCalled();
  expect(cleanupJob).not.toHaveBeenCalled();
  expect(performCleanup).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.resetAllMocks();
  (guardAdminMutation as jest.Mock).mockResolvedValue(null);
  (authenticateRestPrincipal as jest.Mock).mockResolvedValue({
    ok: true,
    userId: "admin-1",
    role: "ADMIN",
    scopes: null,
  });
  getStuckItemStats.mockResolvedValue({ stuckWorkflows: 0, stuckJobs: 0 });
  (getCleanupService as jest.Mock).mockReturnValue({
    cleanupWorkflow,
    cleanupJob,
    performCleanup,
    getStuckItemStats,
  });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /api/admin/cleanup with type "workflow"', () => {
  it("names the run it timed out", async () => {
    cleanupWorkflow.mockResolvedValue(true);

    const res = await post({ type: "workflow", id: 7 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: "Workflow run 7 marked as timed out",
    });
    expect(cleanupWorkflow).toHaveBeenCalledWith(7);
    expect(audit).toHaveBeenCalledWith("admin-1", "cleanup.workflow", "ok");
  });

  it("accepts the id as a string", async () => {
    cleanupWorkflow.mockResolvedValue(true);

    const res = await post({ type: "workflow", id: "7" });

    expect(res.status).toBe(200);
    expect(cleanupWorkflow).toHaveBeenCalledWith(7);
  });

  it("does not claim success when no such run is running", async () => {
    cleanupWorkflow.mockResolvedValue(false);

    const res = await post({ type: "workflow", id: 7 });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "No running workflow run with id 7",
    });
    expect(audit).toHaveBeenCalledWith("admin-1", "cleanup.workflow", "error");
    expect(audit).not.toHaveBeenCalledWith("admin-1", "cleanup.workflow", "ok");
  });

  // Each of these used to reach Number(), which turned true into run 1 and [7] into
  // run 7, or fall through to the full sweep because the id was falsy.
  it.each([
    ["zero", 0],
    ["an empty string", ""],
    ["a word", "abc"],
    ["a fraction", 1.5],
    ["a fractional string", "1.5"],
    ["an exponent string", "1e3"],
    ["a padded string", " 7 "],
    ["a negative number", -7],
    ["a negative string", "-7"],
    ["true", true],
    ["false", false],
    ["null", null],
    ["an array", [7]],
    ["an object", { id: 7 }],
    ["one past the integer column", 2_147_483_648],
    ["a string past the integer column", "2147483648"],
    ["a string past what a number can hold", "99999999999999999999"],
  ])("refuses %s as an id, and runs nothing", async (_label, id) => {
    const res = await post({ type: "workflow", id });

    expect(res.status).toBe(400);
    expectNothingRan();
  });

  it("refuses a request with no id, rather than sweeping", async () => {
    const res = await post({ type: "workflow" });

    expect(res.status).toBe(400);
    expectNothingRan();
  });

  it("takes the largest id the column can hold", async () => {
    cleanupWorkflow.mockResolvedValue(true);

    const res = await post({ type: "workflow", id: 2_147_483_647 });

    expect(res.status).toBe(200);
    expect(cleanupWorkflow).toHaveBeenCalledWith(2_147_483_647);
  });

  it("reports a failed update as a failure, and audits it", async () => {
    cleanupWorkflow.mockRejectedValue(new Error("connection lost"));

    const res = await post({ type: "workflow", id: 7 });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to perform cleanup" });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith("admin-1", "cleanup.workflow", "error");
  });
});

describe('POST /api/admin/cleanup with type "job"', () => {
  it.each([
    ["a string id", "job-1", "job-1"],
    ["a number id", 12, "12"],
  ])("times out the job with %s", async (_label, id, expected) => {
    cleanupJob.mockResolvedValue(undefined);

    const res = await post({ type: "job", id });

    expect(res.status).toBe(200);
    expect(cleanupJob).toHaveBeenCalledWith(expected);
    expect(audit).toHaveBeenCalledWith("admin-1", "cleanup.job", "ok");
  });

  it.each([
    ["no id", {}],
    ["an empty id", { id: "" }],
    ["a boolean id", { id: true }],
    ["a null id", { id: null }],
  ])("refuses %s, rather than sweeping", async (_label, rest) => {
    const res = await post({ type: "job", ...rest });

    expect(res.status).toBe(400);
    expectNothingRan();
  });

  it("audits a failure", async () => {
    cleanupJob.mockRejectedValue(new Error("connection lost"));

    const res = await post({ type: "job", id: "job-1" });

    expect(res.status).toBe(500);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith("admin-1", "cleanup.job", "error");
  });
});

describe("POST /api/admin/cleanup, the full sweep", () => {
  it.each([
    ["an empty object", {}],
    ['type "all"', { type: "all" }],
  ])("runs for %s", async (_label, body) => {
    performCleanup.mockResolvedValue(undefined);

    const res = await post(body);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ message: "Cleanup completed" });
    expect(performCleanup).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith("admin-1", "cleanup.all", "ok");
  });

  it.each([
    ["an unknown type", { type: "workflows" }],
    ["a null type", { type: null }],
    ["an id with no type", { id: 7 }],
    ["an id with type all", { type: "all", id: 7 }],
    ["a field it doesn't know", { type: "all", force: true }],
    ["an array", []],
    ["a number", 7],
    ["a string", "all"],
    ["null", null],
  ])("does not run for %s", async (_label, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expectNothingRan();
  });

  it.each([
    ["an empty body", ""],
    ["a body that is not JSON", "{not json"],
  ])("does not run for %s", async (_label, body) => {
    const res = await postRaw(body);

    expect(res.status).toBe(400);
    expectNothingRan();
  });

  it("audits a failure", async () => {
    performCleanup.mockRejectedValue(new Error("connection lost"));

    const res = await post({ type: "all" });

    expect(res.status).toBe(500);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith("admin-1", "cleanup.all", "error");
  });
});
