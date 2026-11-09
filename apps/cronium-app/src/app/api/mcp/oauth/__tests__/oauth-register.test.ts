/**
 * @jest-environment node
 *
 * Dynamic client registration when Valkey won't store the client.
 */
jest.mock("@/lib/mcp-oauth/store", () => ({ registerClient: jest.fn() }));
jest.mock("@/lib/security/atomic-rate-limiter", () => ({
  consumeAtomicRateLimit: jest.fn(),
}));

import { CacheUnavailableError } from "@/lib/cache/cache-unavailable";
import { registerClient } from "@/lib/mcp-oauth/store";
import { consumeAtomicRateLimit } from "@/lib/security/atomic-rate-limiter";
import { POST } from "../register/route";

const registerMock = registerClient as jest.Mock;

const register = () =>
  POST(
    new Request("https://cronium.example.com/api/mcp/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://client.example/callback"],
        client_name: "a client",
      }),
    }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  (consumeAtomicRateLimit as jest.Mock).mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetAt: new Date(),
  });
  registerMock.mockResolvedValue(undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

it("gives back the client it stored", async () => {
  const res = await register();

  expect(res.status).toBe(201);
  const { client_id } = (await res.json()) as { client_id: string };
  expect(registerMock).toHaveBeenCalledWith(
    expect.objectContaining({ client_id }),
  );
});

it("answers a 503 rather than an id it didn't store", async () => {
  registerMock.mockRejectedValueOnce(
    new CacheUnavailableError("Valkey couldn't answer SET"),
  );

  const res = await register();

  expect(res.status).toBe(503);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.error).toBe("temporarily_unavailable");
  expect(body).not.toHaveProperty("client_id");
});

it("doesn't call any other failure an unavailable Valkey", async () => {
  registerMock.mockRejectedValueOnce(new Error("a bug"));

  await expect(register()).rejects.toThrow("a bug");
});
