import {
  encryptVariableValue,
  decryptVariableValue,
} from "@/lib/security/variable-secret";
import { __resetSecretVaultForTests } from "@/lib/security/secret-vault";

const KEY = "3333333333333333333333333333333333333333333333333333333333333333";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
  __resetSecretVaultForTests();
});
afterAll(() => __resetSecretVaultForTests());

describe("variable-secret encryption (HI-09)", () => {
  it("round-trips a value bound to (userId, key)", () => {
    const env = encryptVariableValue("s3cret", "user-1", "API_KEY");
    expect(env.startsWith("crn.1.")).toBe(true);
    expect(decryptVariableValue(env, "user-1", "API_KEY")).toBe("s3cret");
  });

  it("fails closed when read under a different user (binding mismatch)", () => {
    const env = encryptVariableValue("s3cret", "user-1", "API_KEY");
    expect(() => decryptVariableValue(env, "user-2", "API_KEY")).toThrow();
  });

  it("fails closed when read under a different key", () => {
    const env = encryptVariableValue("s3cret", "user-1", "API_KEY");
    expect(() => decryptVariableValue(env, "user-1", "OTHER")).toThrow();
  });

  it("passes legacy plaintext through unchanged", () => {
    expect(decryptVariableValue("plainvalue", "user-1", "API_KEY")).toBe(
      "plainvalue",
    );
  });
});
