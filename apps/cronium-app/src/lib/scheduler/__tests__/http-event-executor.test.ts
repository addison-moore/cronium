/**
 * @jest-environment node
 */
jest.mock("@/server/storage", () => ({
  storage: { getUserVariables: jest.fn().mockResolvedValue([]) },
}));
jest.mock("@/lib/template-processor", () => ({
  createTemplateContext: jest.fn(() => ({})),
  templateProcessor: { processTemplate: (s: string) => s },
}));
jest.mock("../http-executor", () => ({
  executeHttpRequest: jest.fn(),
}));

import { executeHttpEvent } from "../http-event-executor";
import { executeHttpRequest } from "../http-executor";
import type { Event } from "@/shared/schema";

const mockRequest = executeHttpRequest as jest.Mock;

const httpEvent = {
  id: 1,
  userId: "u1",
  httpMethod: "GET",
  httpUrl: "https://api.example.com/status",
  httpHeaders: [{ key: "Authorization", value: "Bearer x" }],
  httpBody: null,
} as unknown as Event;

beforeEach(() => mockRequest.mockReset());

describe("executeHttpEvent", () => {
  it("fails fast with exit 1 when the event has no URL", async () => {
    const result = await executeHttpEvent({
      ...httpEvent,
      httpUrl: null,
    } as Event);
    expect(result.exitCode).toBe(1);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("succeeds (exit 0) on a 2xx response and includes the status in stdout", async () => {
    mockRequest.mockResolvedValue({
      data: { status: 200, statusText: "OK", headers: {}, body: { ok: true } },
    });

    const result = await executeHttpEvent(httpEvent);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("200");
    // Method/url/headers were passed through to the low-level request.
    expect(mockRequest).toHaveBeenCalledWith(
      "GET",
      "https://api.example.com/status",
      [{ key: "Authorization", value: "Bearer x" }],
      null,
    );
  });

  it("fails (exit 1) on a 4xx/5xx response", async () => {
    mockRequest.mockResolvedValue({
      data: { status: 404, statusText: "Not Found", headers: {}, body: "" },
      error: "Request failed with status code 404",
    });

    const result = await executeHttpEvent(httpEvent);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("404");
  });

  it("fails (exit 1) on a transport error with no response", async () => {
    mockRequest.mockResolvedValue({ data: null, error: "ECONNREFUSED" });

    const result = await executeHttpEvent(httpEvent);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ECONNREFUSED");
  });
});
