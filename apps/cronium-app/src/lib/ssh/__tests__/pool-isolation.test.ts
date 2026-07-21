/**
 * @jest-environment node
 */
const mockNodeSSHInstances: Array<{
  connect: jest.Mock;
  execCommand: jest.Mock;
  dispose: jest.Mock;
}> = [];

jest.mock("node-ssh", () => ({
  NodeSSH: jest.fn().mockImplementation(() => {
    const instance = {
      connect: jest.fn().mockResolvedValue(undefined),
      execCommand: jest.fn().mockResolvedValue({
        stdout: "test\n",
        stderr: "",
      }),
      dispose: jest.fn(),
    };
    mockNodeSSHInstances.push(instance);
    return instance;
  }),
}));

import { createServerSSHConnectionScope, createSSHPoolKey } from "../pool-key";
import { SSHConnectionManager } from "../shared";

const endpoint = {
  host: "shared-host.example",
  username: "deploy",
  port: 22,
  authType: "password" as const,
};

beforeEach(() => {
  mockNodeSSHInstances.length = 0;
  jest.clearAllMocks();
});

describe("SSH pool identity", () => {
  it("is opaque and changes for user/server scope and credential rotation", () => {
    const userOneScope = createServerSSHConnectionScope("user-1", 10);
    const userTwoScope = createServerSSHConnectionScope("user-2", 11);
    const first = createSSHPoolKey({
      ...endpoint,
      connectionScope: userOneScope,
      authCredential: "first-password",
    });
    const otherUser = createSSHPoolKey({
      ...endpoint,
      connectionScope: userTwoScope,
      authCredential: "second-password",
    });
    const rotated = createSSHPoolKey({
      ...endpoint,
      connectionScope: userOneScope,
      authCredential: "rotated-password",
    });

    expect(first).not.toBe(otherUser);
    expect(first).not.toBe(rotated);
    expect(first).not.toContain("user-1");
    expect(first).not.toContain("first-password");
    expect(first).not.toContain(endpoint.host);
  });

  it("does not share a connection lock or pool entry across two users on the same endpoint", async () => {
    const manager = new SSHConnectionManager();

    try {
      const [userOne, userTwo] = await Promise.all([
        manager.getPooledConnection({
          ...endpoint,
          connectionScope: createServerSSHConnectionScope("user-1", 10),
          authCredential: "first-password",
        }),
        manager.getPooledConnection({
          ...endpoint,
          connectionScope: createServerSSHConnectionScope("user-2", 11),
          authCredential: "second-password",
        }),
      ]);

      expect(userOne.ssh).not.toBe(userTwo.ssh);
      expect(mockNodeSSHInstances).toHaveLength(2);
      expect(mockNodeSSHInstances[0]?.connect).toHaveBeenCalledWith(
        expect.objectContaining({ password: "first-password" }),
      );
      expect(mockNodeSSHInstances[1]?.connect).toHaveBeenCalledWith(
        expect.objectContaining({ password: "second-password" }),
      );
    } finally {
      manager.dispose();
    }
  });

  it("does not share across server records even when credentials match", async () => {
    const manager = new SSHConnectionManager();

    try {
      const first = await manager.getPooledConnection({
        ...endpoint,
        connectionScope: createServerSSHConnectionScope("user-1", 10),
        authCredential: "same-password",
      });
      const second = await manager.getPooledConnection({
        ...endpoint,
        connectionScope: createServerSSHConnectionScope("user-1", 12),
        authCredential: "same-password",
      });

      expect(first.ssh).not.toBe(second.ssh);
      expect(mockNodeSSHInstances).toHaveLength(2);
    } finally {
      manager.dispose();
    }
  });

  it("still reuses a connection for the same scoped credential", async () => {
    const manager = new SSHConnectionManager();
    const request = {
      ...endpoint,
      connectionScope: createServerSSHConnectionScope("user-1", 10),
      authCredential: "first-password",
    };

    try {
      const first = await manager.getPooledConnection(request);
      const second = await manager.getPooledConnection(request);

      expect(first).toBe(second);
      expect(mockNodeSSHInstances).toHaveLength(1);
    } finally {
      manager.dispose();
    }
  });
});
