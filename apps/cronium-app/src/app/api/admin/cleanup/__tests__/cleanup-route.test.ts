/**
 * @jest-environment node
 */

// The route's handling of `type: "workflow"`. What cleanupWorkflow does to the
// database is covered against real Postgres in tests/storage/workflow-timeout.test.ts.

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
import { auditAdminAction } from "@/lib/security/admin-mutation";
import { getCleanupService } from "@/lib/services/workflow-cleanup-service";

const audit = auditAdminAction as jest.Mock;
const cleanupWorkflow = jest.fn();

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost:5001/api/admin/cleanup", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  (getCleanupService as jest.Mock).mockReturnValue({ cleanupWorkflow });
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

  it.each([["abc"], ["1.5"]])(
    "treats %s as a run that doesn't exist, without querying",
    async (id) => {
      const res = await post({ type: "workflow", id });

      expect(res.status).toBe(404);
      expect(cleanupWorkflow).not.toHaveBeenCalled();
    },
  );

  it("reports a failed update as a failure", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    cleanupWorkflow.mockRejectedValue(new Error("connection lost"));

    const res = await post({ type: "workflow", id: 7 });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to perform cleanup" });
    expect(audit).not.toHaveBeenCalled();
  });
});
