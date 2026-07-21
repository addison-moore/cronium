import {
  generateRecoveryCodes,
  hashRecoveryCode,
} from "@/lib/security/mfa-recovery";

describe("MFA recovery codes", () => {
  it("generates 10 unique codes with matching hashes", () => {
    const { plaintext, hashes } = generateRecoveryCodes();
    expect(plaintext).toHaveLength(10);
    expect(hashes).toHaveLength(10);
    expect(new Set(plaintext).size).toBe(10);
    plaintext.forEach((code, i) => {
      expect(hashRecoveryCode(code)).toBe(hashes[i]);
    });
  });

  it("hashes are normalization-insensitive (dashes, spaces, case)", () => {
    const base = hashRecoveryCode("abcde-12345");
    expect(hashRecoveryCode("ABCDE-12345")).toBe(base);
    expect(hashRecoveryCode("abcde12345")).toBe(base);
    expect(hashRecoveryCode(" abcde-12345 ")).toBe(base);
  });

  it("different codes hash differently", () => {
    expect(hashRecoveryCode("aaaaa-11111")).not.toBe(
      hashRecoveryCode("bbbbb-22222"),
    );
  });
});
