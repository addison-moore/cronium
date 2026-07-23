import { CredentialEncryption } from "../credential-encryption";

/**
 * Phase 2.1 rotation: credential-encryption must decrypt values written under a
 * retired ENCRYPTION_KEY (so a rotation does not break tool/OAuth credentials
 * before the driver re-encrypts them), and must report which values still need
 * re-encryption.
 */
const KEY_A =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("CredentialEncryption key rotation", () => {
  const svc = CredentialEncryption.getInstance();
  const secret = { token: "s3cr3t", scope: "read" };

  afterEach(() => {
    delete process.env.ENCRYPTION_KEYS_RETIRED;
  });

  it("decrypts a value written under a retired key and flags it for re-encryption", () => {
    delete process.env.ENCRYPTION_KEYS_RETIRED;
    svc.initialize(KEY_A);
    const underA = svc.encrypt(secret);

    // Rotate: B active, A retired.
    process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify([KEY_A]);
    svc.initialize(KEY_B);

    expect(svc.decrypt(underA)).toEqual(secret); // via retired fallback
    expect(svc.isUnderActiveKey(underA)).toBe(false);

    const underB = svc.encrypt(secret);
    expect(svc.isUnderActiveKey(underB)).toBe(true);
    expect(svc.decrypt(underB)).toEqual(secret);
  });

  it("resumes an interrupted rotation: skips already-rotated values, re-encrypts the rest", () => {
    // Simulate an interrupted rotation: value1 was reached (now under B),
    // value2 was not (still under A). Both keys are in the ring.
    delete process.env.ENCRYPTION_KEYS_RETIRED;
    svc.initialize(KEY_A);
    const value2StillOldA = svc.encrypt({ id: 2 });

    process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify([KEY_A]);
    svc.initialize(KEY_B);
    const value1AlreadyNewB = svc.encrypt({ id: 1 });

    // A resumed pass must re-encrypt only value2, and leave value1 untouched.
    expect(svc.isUnderActiveKey(value1AlreadyNewB)).toBe(true); // skip
    expect(svc.isUnderActiveKey(value2StillOldA)).toBe(false); // re-encrypt

    const value2Rotated = svc.encrypt(svc.decrypt(value2StillOldA));
    expect(svc.isUnderActiveKey(value2Rotated)).toBe(true);
    expect(svc.decrypt(value2Rotated)).toEqual({ id: 2 });
  });

  it("cannot decrypt a retired-key value once the retired key is removed", () => {
    delete process.env.ENCRYPTION_KEYS_RETIRED;
    svc.initialize(KEY_A);
    const underA = svc.encrypt(secret);

    // Rotation complete: only B, no retired keys.
    delete process.env.ENCRYPTION_KEYS_RETIRED;
    svc.initialize(KEY_B);

    expect(() => svc.decrypt(underA)).toThrow(
      /failed authenticated decryption/,
    );
  });
});
