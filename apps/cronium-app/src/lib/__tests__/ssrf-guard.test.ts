import { assertRequestUrlIsPublic } from "../ssrf-guard";
import { isDisallowedIp, SsrfBlockedError } from "../tools/safe-fetch";

describe("ssrf-guard", () => {
  describe("assertRequestUrlIsPublic", () => {
    it("allows public http/https URLs (hostname validated later at connect time)", () => {
      expect(() =>
        assertRequestUrlIsPublic("https://api.example.com/v1/data"),
      ).not.toThrow();
      expect(() =>
        assertRequestUrlIsPublic("http://example.com"),
      ).not.toThrow();
    });

    it("rejects the cloud metadata IP literal", () => {
      expect(() =>
        assertRequestUrlIsPublic(
          "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        ),
      ).toThrow(SsrfBlockedError);
    });

    it("rejects localhost and RFC1918 IP literals", () => {
      expect(() => assertRequestUrlIsPublic("http://127.0.0.1:5001")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertRequestUrlIsPublic("http://10.0.0.5")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertRequestUrlIsPublic("http://192.168.1.1")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertRequestUrlIsPublic("http://[::1]/")).toThrow(
        SsrfBlockedError,
      );
    });

    it("rejects non-http(s) schemes", () => {
      expect(() => assertRequestUrlIsPublic("file:///etc/passwd")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertRequestUrlIsPublic("gopher://internal:70/")).toThrow(
        SsrfBlockedError,
      );
    });

    it("rejects malformed URLs", () => {
      expect(() => assertRequestUrlIsPublic("not a url")).toThrow(
        SsrfBlockedError,
      );
    });
  });

  describe("isDisallowedIp", () => {
    it("blocks internal ranges", () => {
      expect(isDisallowedIp("169.254.169.254")).toBe(true); // metadata
      expect(isDisallowedIp("127.0.0.1")).toBe(true); // loopback
      expect(isDisallowedIp("10.1.2.3")).toBe(true); // private
      expect(isDisallowedIp("172.16.0.1")).toBe(true); // private
      expect(isDisallowedIp("192.168.0.1")).toBe(true); // private
      expect(isDisallowedIp("100.64.0.1")).toBe(true); // CGNAT
      expect(isDisallowedIp("::1")).toBe(true); // ipv6 loopback
      expect(isDisallowedIp("fd00::1")).toBe(true); // ipv6 ULA
    });

    it("allows public addresses", () => {
      expect(isDisallowedIp("8.8.8.8")).toBe(false);
      expect(isDisallowedIp("1.1.1.1")).toBe(false);
      expect(isDisallowedIp("93.184.216.34")).toBe(false); // example.com
    });

    it("blocks an ipv4-mapped ipv6 pointing at an internal address", () => {
      expect(isDisallowedIp("::ffff:127.0.0.1")).toBe(true);
      expect(isDisallowedIp("::ffff:169.254.169.254")).toBe(true);
    });
  });
});
