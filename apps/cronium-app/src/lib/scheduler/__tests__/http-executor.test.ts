/**
 * @jest-environment node
 */
// Mock axios and the SSRF guard module (the guard itself has its own suite in
// src/lib/__tests__/ssrf-guard.test.ts — here we only assert the executor
// consults it and wires the guarded agents into the request).
jest.mock("axios", () => {
  const axiosMock = jest.fn();
  return { __esModule: true, default: axiosMock };
});
jest.mock("@/lib/ssrf-guard", () => ({
  assertRequestUrlIsPublic: jest.fn(),
  ssrfHttpAgent: { tag: "guarded-http-agent" },
  ssrfHttpsAgent: { tag: "guarded-https-agent" },
}));

import axios from "axios";
import { executeHttpRequest } from "../http-executor";
import {
  assertRequestUrlIsPublic,
  ssrfHttpAgent,
  ssrfHttpsAgent,
} from "@/lib/ssrf-guard";
import { SsrfBlockedError } from "@/lib/tools/safe-fetch";

const mockAxios = axios as unknown as jest.Mock;
const mockGuard = assertRequestUrlIsPublic as jest.Mock;

const URL = "https://api.example.com/things";

const okResponse = {
  status: 200,
  statusText: "OK",
  headers: { "content-type": "application/json" },
  data: { ok: true },
};

// The single positional config object the executor handed to axios.
const axiosConfig = () =>
  mockAxios.mock.calls[0]?.[0] as Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  // clearAllMocks does not drop per-test mockImplementations; reset the guard
  // back to "allows everything" explicitly.
  mockGuard.mockReset();
  mockAxios.mockResolvedValue(okResponse);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("executeHttpRequest — preconditions", () => {
  it("returns an error without calling axios when no URL is given", async () => {
    const result = await executeHttpRequest("GET", "");

    expect(result).toEqual({
      data: null,
      error: "No URL provided for HTTP request",
    });
    expect(mockAxios).not.toHaveBeenCalled();
    expect(mockGuard).not.toHaveBeenCalled();
  });

  it("returns the guard's message and skips the request when the URL is SSRF-blocked", async () => {
    mockGuard.mockImplementation(() => {
      throw new SsrfBlockedError(
        "Blocked request to private address 169.254.169.254",
      );
    });

    const result = await executeHttpRequest(
      "GET",
      "http://169.254.169.254/latest/meta-data",
    );

    expect(mockGuard).toHaveBeenCalledWith(
      "http://169.254.169.254/latest/meta-data",
    );
    expect(result.data).toBeNull();
    expect(result.error).toContain("169.254.169.254");
    expect(mockAxios).not.toHaveBeenCalled();
  });

  it("rethrows unexpected guard errors instead of swallowing them", async () => {
    mockGuard.mockImplementation(() => {
      throw new Error("guard crashed");
    });

    await expect(executeHttpRequest("GET", URL)).rejects.toThrow(
      "guard crashed",
    );
    expect(mockAxios).not.toHaveBeenCalled();
  });
});

describe("executeHttpRequest — request construction", () => {
  it("builds a GET with hardened transport settings and shaped response", async () => {
    const result = await executeHttpRequest(undefined, URL, [
      { key: "Authorization", value: "Bearer abc" },
      { key: "", value: "dropped" },
      { key: "X-Empty", value: "" },
    ]);

    expect(axiosConfig()).toMatchObject({
      method: "GET",
      url: URL,
      headers: { Authorization: "Bearer abc" },
      timeout: 30000,
      maxRedirects: 0,
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 10 * 1024 * 1024,
    });
    // The SSRF-guarded agents must be wired in so the resolved IP is
    // re-validated at connect time.
    expect(axiosConfig().httpAgent).toBe(ssrfHttpAgent);
    expect(axiosConfig().httpsAgent).toBe(ssrfHttpsAgent);
    // Headers with an empty key or value are dropped.
    expect(axiosConfig().headers).toEqual({ Authorization: "Bearer abc" });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: { ok: true },
    });
  });

  it("does not attach a body to GET requests even when one is provided", async () => {
    await executeHttpRequest("GET", URL, [], { should: "be ignored" });

    expect(axiosConfig().data).toBeUndefined();
  });

  it("JSON-stringifies object bodies by default for POST", async () => {
    await executeHttpRequest("POST", URL, [], { a: 1, b: "two" });

    expect(axiosConfig().data).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("passes string bodies through untouched for PUT", async () => {
    await executeHttpRequest("PUT", URL, [], "raw-payload");

    expect(axiosConfig().data).toBe("raw-payload");
  });

  it("attaches the body for lowercase method names too", async () => {
    await executeHttpRequest("patch", URL, [], { x: 1 });

    expect(axiosConfig().data).toBe(JSON.stringify({ x: 1 }));
  });

  it("form-encodes object bodies when Content-Type is x-www-form-urlencoded", async () => {
    await executeHttpRequest(
      "POST",
      URL,
      [{ key: "Content-Type", value: "application/x-www-form-urlencoded" }],
      { a: "1", b: "two words" },
    );

    expect(axiosConfig().data).toBe("a=1&b=two+words");
  });

  it("passes a string body through under x-www-form-urlencoded", async () => {
    await executeHttpRequest(
      "POST",
      URL,
      [{ key: "content-type", value: "application/x-www-form-urlencoded" }],
      "a=1&b=2",
    );

    expect(axiosConfig().data).toBe("a=1&b=2");
  });

  it("stringifies a numeric body under x-www-form-urlencoded", async () => {
    await executeHttpRequest(
      "POST",
      URL,
      [{ key: "Content-Type", value: "application/x-www-form-urlencoded" }],
      42,
    );

    expect(axiosConfig().data).toBe("42");
  });

  it("stringifies a boolean body under x-www-form-urlencoded", async () => {
    await executeHttpRequest(
      "POST",
      URL,
      [{ key: "Content-Type", value: "application/x-www-form-urlencoded" }],
      true,
    );

    expect(axiosConfig().data).toBe("true");
  });

  it("sends an empty body for unserializable types under x-www-form-urlencoded", async () => {
    await executeHttpRequest(
      "POST",
      URL,
      [{ key: "Content-Type", value: "application/x-www-form-urlencoded" }],
      () => "not serializable",
    );

    expect(axiosConfig().data).toBe("");
  });

  it("builds FormData for multipart/form-data bodies", async () => {
    await executeHttpRequest(
      "POST",
      URL,
      [{ key: "Content-Type", value: "multipart/form-data" }],
      { field: "value", n: 7 },
    );

    const data = axiosConfig().data as FormData;
    expect(data).toBeInstanceOf(FormData);
    expect(data.get("field")).toBe("value");
    expect(data.get("n")).toBe("7");
  });

  it("falls back to the raw body when JSON serialization fails", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await executeHttpRequest("POST", URL, [], circular);

    // JSON.stringify throws on the cycle; the executor uses the body as-is.
    expect(axiosConfig().data).toBe(circular);
  });
});

describe("executeHttpRequest — error handling", () => {
  it("returns the response details plus an error for a non-2xx response", async () => {
    mockAxios.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 404"), {
        response: {
          status: 404,
          statusText: "Not Found",
          headers: { "x-req": "1" },
          data: { message: "missing" },
        },
      }),
    );

    const result = await executeHttpRequest("GET", URL);

    expect(result.error).toBe("Request failed with status code 404");
    expect(result.data).toEqual({
      status: 404,
      statusText: "Not Found",
      headers: { "x-req": "1" },
      body: { message: "missing" },
    });
  });

  it("returns a zero-status structured error for network failures", async () => {
    mockAxios.mockRejectedValue(new Error("connect ECONNREFUSED 1.2.3.4:443"));

    const result = await executeHttpRequest("GET", URL);

    expect(result.error).toBe("connect ECONNREFUSED 1.2.3.4:443");
    expect(result.data).toEqual({
      status: 0,
      statusText: "Error",
      headers: {},
      body: null,
    });
  });

  it("surfaces axios timeout aborts as structured errors", async () => {
    mockAxios.mockRejectedValue(
      Object.assign(new Error("timeout of 30000ms exceeded"), {
        code: "ECONNABORTED",
      }),
    );

    const result = await executeHttpRequest("POST", URL, [], { a: 1 });

    expect(result.error).toBe("timeout of 30000ms exceeded");
    expect(result.data?.status).toBe(0);
  });
});
