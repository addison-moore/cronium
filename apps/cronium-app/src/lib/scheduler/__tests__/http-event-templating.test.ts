/**
 * @jest-environment node
 *
 * HTTP request events with the real template processor: what is sent has to be the
 * value, not an HTML-escaped copy of it, and a webhook payload must only be able to
 * reach what the event's author pointed at it.
 */
jest.mock("@/server/storage", () => ({
  storage: { getUserVariables: jest.fn() },
}));
jest.mock("../http-executor", () => ({
  executeHttpRequest: jest.fn(),
}));

import { executeHttpEvent } from "../http-event-executor";
import { executeHttpRequest } from "../http-executor";
import { storage } from "@/server/storage";
import type { Event } from "@/shared/schema";

const mockRequest = executeHttpRequest as jest.Mock;
const mockVariables = storage.getUserVariables as jest.Mock;

const event = (overrides: Record<string, unknown>) =>
  ({
    id: 1,
    name: "Call",
    userId: "u1",
    httpMethod: "POST",
    httpHeaders: [],
    httpBody: null,
    ...overrides,
  }) as unknown as Event;

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ data: { status: 200, statusText: "OK" } });
  mockVariables.mockReset();
  mockVariables.mockResolvedValue([
    { key: "apiBase", value: "https://real.example" },
    { key: "token", value: "abc==" },
  ]);
});

describe("executeHttpEvent templating", () => {
  it("sends values verbatim in the URL and headers", async () => {
    await executeHttpEvent(
      event({
        httpUrl: "{{cronium.getVariables.apiBase}}/x?q={{cronium.input.q}}",
        httpHeaders: [
          {
            key: "Authorization",
            value: "Bearer {{cronium.getVariables.token}}",
          },
        ],
      }),
      { q: "a=b&c" },
    );

    expect(mockRequest).toHaveBeenCalledWith(
      "POST",
      "https://real.example/x?q=a=b&c",
      [{ key: "Authorization", value: "Bearer abc==" }],
      null,
    );
  });

  it("keeps a JSON body valid and its structure the author's", async () => {
    await executeHttpEvent(
      event({
        httpUrl: "https://real.example",
        httpBody:
          '{"name": "{{cronium.input.name}}", "rows": {{cronium.input.rows}}}',
      }),
      { name: `x","admin":"true`, rows: [{ id: 1 }] },
    );

    const body = mockRequest.mock.calls[0]?.[3] as string;
    expect(JSON.parse(body)).toEqual({
      name: `x","admin":"true`,
      rows: [{ id: 1 }],
    });
  });

  it("does not let a webhook payload shadow a user variable", async () => {
    await executeHttpEvent(
      event({
        httpUrl: "{{cronium.getVariables.apiBase}}/charge",
        httpHeaders: [
          {
            key: "Authorization",
            value: "Bearer {{cronium.getVariables.token}}",
          },
        ],
      }),
      { apiBase: "https://attacker.example", token: "stolen" },
    );

    expect(mockRequest).toHaveBeenCalledWith(
      "POST",
      "https://real.example/charge",
      [{ key: "Authorization", value: "Bearer abc==" }],
      null,
    );
  });
});
