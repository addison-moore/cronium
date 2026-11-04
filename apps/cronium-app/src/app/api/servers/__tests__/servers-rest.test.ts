/**
 * @jest-environment node
 */
jest.mock("@/lib/api-auth", () => ({
  authenticateRestPrincipal: jest.fn(() =>
    Promise.resolve({ ok: true, userId: "user-1", role: "USER", scopes: null }),
  ),
  restPrincipalErrorResponse: jest.fn(),
}));
jest.mock("@/server/storage", () => ({
  storage: { getServer: jest.fn(), updateServer: jest.fn() },
}));
jest.mock("@/lib/ssh", () => ({
  sshService: {
    testConnection: jest.fn(() =>
      Promise.resolve({ success: true, message: "ok" }),
    ),
  },
}));

import { NextRequest } from "next/server";
import { PUT } from "../[id]/route";
import { sshService } from "@/lib/ssh";
import { storage } from "@/server/storage";

const s = storage as unknown as Record<string, jest.Mock>;
const testConnection = sshService.testConnection as unknown as jest.Mock;

const put = (body: unknown) =>
  PUT(
    new NextRequest("http://localhost:5001/api/servers/1", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "1" }) },
  );

beforeEach(() => {
  jest.clearAllMocks();
  s.getServer!.mockResolvedValue({
    id: 1,
    userId: "user-1",
    address: "10.0.0.1",
    username: "root",
    port: 22,
  });
  s.updateServer!.mockResolvedValue({
    id: 1,
    userId: "user-1",
    sshKey: "stored",
    password: null,
  });
});

describe("PUT /api/servers/[id]", () => {
  it("keeps the stored key when sshKey is blank, as the schema promises", async () => {
    await put({ name: "renamed", sshKey: "" });
    expect(s.updateServer).toHaveBeenCalledWith(1, { name: "renamed" });
  });

  it("replaces the key when a new one is given", async () => {
    await put({ sshKey: "NEW-KEY" });
    expect(s.updateServer).toHaveBeenCalledWith(1, { sshKey: "NEW-KEY" });
  });

  it("checks a new key against the pinned host key while the target is unchanged", async () => {
    await put({ sshKey: "NEW-KEY" });
    expect(testConnection).toHaveBeenCalledWith(
      "10.0.0.1",
      "NEW-KEY",
      "root",
      22,
      undefined,
      1,
    );
  });

  it.each([{ address: "10.0.0.2" }, { port: 2222 }])(
    "does not apply the old pin to a new target (%j)",
    async (target) => {
      await put({ sshKey: "NEW-KEY", ...target });
      expect(testConnection.mock.calls[0]?.[5]).toBeUndefined();
    },
  );
});
