/**
 * @jest-environment node
 */

// Factory mocks physically above imports (house pattern): the host verifier
// pulls the storage/db chain via dynamic import when persisting/reading a
// server's trusted key, so it must be mocked before the module loads.
const mockGetServer = jest.fn();
const mockUpdateServerSshHostKey = jest.fn();

jest.mock("@server/storage", () => ({
  storage: {
    getServer: mockGetServer,
    updateServerSshHostKey: mockUpdateServerSshHostKey,
  },
}));

import {
  createHostVerifier,
  decideHostKey,
  fingerprintHostKey,
  isValidStoredFingerprint,
  resolveHostKeyPolicy,
  DEFAULT_HOST_KEY_POLICY,
} from "../host-verifier";

const KEY_A = Buffer.from("host-key-material-A");
const KEY_B = Buffer.from("host-key-material-B");
const FP_A = fingerprintHostKey(KEY_A);
const FP_B = fingerprintHostKey(KEY_B);

/** Run a hostVerifier and resolve with the boolean it passes to verify(). */
function runVerifier(
  verifier: (key: Buffer, verify: (v: boolean) => void) => void,
  key: Buffer,
): Promise<boolean> {
  return new Promise((resolve) => {
    verifier(key, resolve);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServer.mockResolvedValue(undefined);
  mockUpdateServerSshHostKey.mockResolvedValue(undefined);
});

describe("fingerprintHostKey", () => {
  it("produces a stable OpenSSH-style SHA-256 fingerprint", () => {
    expect(FP_A).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    // Stable across calls and unpadded.
    expect(fingerprintHostKey(KEY_A)).toBe(FP_A);
    expect(FP_A.endsWith("=")).toBe(false);
  });

  it("differs for different key material", () => {
    expect(FP_A).not.toBe(FP_B);
  });
});

describe("isValidStoredFingerprint", () => {
  it("accepts well-formed fingerprints and rejects malformed/empty values", () => {
    expect(isValidStoredFingerprint(FP_A)).toBe(true);
    expect(isValidStoredFingerprint(null)).toBe(false);
    expect(isValidStoredFingerprint(undefined)).toBe(false);
    expect(isValidStoredFingerprint("")).toBe(false);
    expect(isValidStoredFingerprint("not-a-fingerprint")).toBe(false);
    expect(isValidStoredFingerprint("MD5:aa:bb")).toBe(false);
  });
});

describe("resolveHostKeyPolicy", () => {
  it("passes through known policies", () => {
    expect(resolveHostKeyPolicy("strict")).toBe("strict");
    expect(resolveHostKeyPolicy("accept-new")).toBe("accept-new");
    expect(resolveHostKeyPolicy("insecure")).toBe("insecure");
  });

  it("defaults to accept-new for unset/unknown values", () => {
    expect(resolveHostKeyPolicy(undefined)).toBe(DEFAULT_HOST_KEY_POLICY);
    expect(DEFAULT_HOST_KEY_POLICY).toBe("accept-new");
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    expect(resolveHostKeyPolicy("bogus")).toBe("accept-new");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("decideHostKey (pure policy logic)", () => {
  it("accept-new: first contact records and accepts", () => {
    const d = decideHostKey({
      policy: "accept-new",
      storedFingerprint: null,
      presentedFingerprint: FP_A,
      serverLabel: "host (server #1)",
    });
    expect(d.accept).toBe(true);
    expect(d.persistFingerprint).toBe(FP_A);
  });

  it("known key match accepts without a rewrite", () => {
    const d = decideHostKey({
      policy: "accept-new",
      storedFingerprint: FP_A,
      presentedFingerprint: FP_A,
      serverLabel: "host",
    });
    expect(d.accept).toBe(true);
    expect(d.persistFingerprint).toBeUndefined();
  });

  it("mismatch rejects with both fingerprints in the error (accept-new)", () => {
    const d = decideHostKey({
      policy: "accept-new",
      storedFingerprint: FP_A,
      presentedFingerprint: FP_B,
      serverLabel: "prod-host (server #7)",
    });
    expect(d.accept).toBe(false);
    expect(d.persistFingerprint).toBeUndefined();
    expect(d.error).toContain(FP_A);
    expect(d.error).toContain(FP_B);
    expect(d.error).toContain("prod-host (server #7)");
  });

  it("mismatch rejects under strict too", () => {
    const d = decideHostKey({
      policy: "strict",
      storedFingerprint: FP_A,
      presentedFingerprint: FP_B,
      serverLabel: "host",
    });
    expect(d.accept).toBe(false);
    expect(d.error).toContain(FP_A);
    expect(d.error).toContain(FP_B);
  });

  it("strict rejects an unknown host", () => {
    const d = decideHostKey({
      policy: "strict",
      storedFingerprint: null,
      presentedFingerprint: FP_A,
      serverLabel: "host",
    });
    expect(d.accept).toBe(false);
    expect(d.error).toContain("strict");
    expect(d.error).toContain(FP_A);
  });

  it("insecure warns and accepts regardless of stored key", () => {
    const d = decideHostKey({
      policy: "insecure",
      storedFingerprint: FP_A,
      presentedFingerprint: FP_B,
      serverLabel: "host",
    });
    expect(d.accept).toBe(true);
    expect(d.warn).toContain("insecure");
  });

  it("malformed stored value is treated as unknown (records under accept-new)", () => {
    const d = decideHostKey({
      policy: "accept-new",
      storedFingerprint: "corrupt-value",
      presentedFingerprint: FP_A,
      serverLabel: "host",
    });
    expect(d.accept).toBe(true);
    expect(d.persistFingerprint).toBe(FP_A);
  });

  it("malformed stored value is rejected under strict", () => {
    const d = decideHostKey({
      policy: "strict",
      storedFingerprint: "corrupt-value",
      presentedFingerprint: FP_A,
      serverLabel: "host",
    });
    expect(d.accept).toBe(false);
  });
});

describe("createHostVerifier (storage-wired)", () => {
  it("accept-new first contact persists the key and accepts", async () => {
    mockGetServer.mockResolvedValue({ id: 1, sshHostKey: null });
    const verifier = createHostVerifier({
      serverId: 1,
      host: "h",
      policy: "accept-new",
    });

    const accepted = await runVerifier(verifier, KEY_A);

    expect(accepted).toBe(true);
    expect(mockUpdateServerSshHostKey).toHaveBeenCalledWith(1, FP_A);
  });

  it("known match accepts and does not rewrite the stored key", async () => {
    mockGetServer.mockResolvedValue({ id: 1, sshHostKey: FP_A });
    const verifier = createHostVerifier({
      serverId: 1,
      host: "h",
      policy: "accept-new",
    });

    const accepted = await runVerifier(verifier, KEY_A);

    expect(accepted).toBe(true);
    expect(mockUpdateServerSshHostKey).not.toHaveBeenCalled();
  });

  it("mismatch rejects (fails closed) and does not persist", async () => {
    const err = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockGetServer.mockResolvedValue({ id: 1, sshHostKey: FP_A });
    const verifier = createHostVerifier({
      serverId: 1,
      host: "h",
      policy: "accept-new",
    });

    const accepted = await runVerifier(verifier, KEY_B);

    expect(accepted).toBe(false);
    expect(mockUpdateServerSshHostKey).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("insecure policy accepts without ever reading storage", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const verifier = createHostVerifier({
      serverId: 1,
      host: "h",
      policy: "insecure",
    });

    const accepted = await runVerifier(verifier, KEY_A);

    expect(accepted).toBe(true);
    expect(mockGetServer).not.toHaveBeenCalled();
    expect(mockUpdateServerSshHostKey).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("with no server id, accept-new accepts but cannot persist", async () => {
    const verifier = createHostVerifier({
      host: "h",
      policy: "accept-new",
    });

    const accepted = await runVerifier(verifier, KEY_A);

    expect(accepted).toBe(true);
    expect(mockGetServer).not.toHaveBeenCalled();
    expect(mockUpdateServerSshHostKey).not.toHaveBeenCalled();
  });

  it("fails closed when the storage lookup throws", async () => {
    const err = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockGetServer.mockRejectedValue(new Error("db down"));
    const verifier = createHostVerifier({
      serverId: 1,
      host: "h",
      policy: "strict",
    });

    const accepted = await runVerifier(verifier, KEY_A);

    expect(accepted).toBe(false);
    err.mockRestore();
  });

  it("still accepts an unknown key when persistence fails (accept-new)", async () => {
    const err = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockGetServer.mockResolvedValue({ id: 1, sshHostKey: null });
    mockUpdateServerSshHostKey.mockRejectedValue(new Error("write failed"));
    const verifier = createHostVerifier({
      serverId: 1,
      host: "h",
      policy: "accept-new",
    });

    const accepted = await runVerifier(verifier, KEY_A);

    expect(accepted).toBe(true);
    err.mockRestore();
  });
});
