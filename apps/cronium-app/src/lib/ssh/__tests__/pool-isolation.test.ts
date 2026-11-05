/**
 * @jest-environment node
 */
import { createServerSSHConnectionScope, createSSHPoolKey } from "../pool-key";

const endpoint = {
  host: "shared-host.example",
  username: "deploy",
  port: 22,
  authType: "password" as const,
};

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
});
