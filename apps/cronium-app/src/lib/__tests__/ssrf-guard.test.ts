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

    // The form that matters: URL parsing serializes mapped addresses in hex, so
    // the dotted spellings above are never what reaches the guard from a URL.
    it.each([
      ["::ffff:7f00:1", "127.0.0.1 mapped, hex"],
      ["::ffff:a9fe:a9fe", "169.254.169.254 mapped, hex"],
      ["0:0:0:0:0:ffff:a00:1", "10.0.0.1 mapped, uncompressed"],
      ["::7f00:1", "127.0.0.1 IPv4-compatible"],
      ["::ffff:0:a9fe:a9fe", "169.254.169.254 translated"],
      ["64:ff9b::a9fe:a9fe", "169.254.169.254 via NAT64"],
      ["64:ff9b:1::1", "local-use NAT64"],
      ["2002:7f00:1::", "127.0.0.1 via 6to4"],
      ["2002:a9fe:a9fe::1", "169.254.169.254 via 6to4"],
      ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "Teredo"],
      ["::", "unspecified"],
      ["0:0:0:0:0:0:0:1", "loopback, uncompressed"],
      ["fe80::1", "link-local"],
      ["febf::1", "link-local, top of the /10"],
      ["fe80::1%eth0", "link-local with a zone id"],
      ["fec0::1", "site-local"],
      ["fc00::1", "ULA, low half of the /7"],
      ["fdff::1", "ULA, high half of the /7"],
      ["ff02::1", "multicast"],
      ["100::1", "discard"],
    ])("blocks %s (%s)", (address) => {
      expect(isDisallowedIp(address)).toBe(true);
    });

    it.each([
      ["2606:4700:4700::1111", "Cloudflare DNS"],
      ["2001:4860:4860::8888", "Google DNS"],
      ["::ffff:808:808", "8.8.8.8 mapped"],
      ["64:ff9b::808:808", "8.8.8.8 via NAT64"],
      ["2002:808:808::1", "8.8.8.8 via 6to4"],
    ])("allows public %s (%s)", (address) => {
      expect(isDisallowedIp(address)).toBe(false);
    });

    it("treats anything that is not an IP literal as disallowed", () => {
      expect(isDisallowedIp("not-an-ip")).toBe(true);
      expect(isDisallowedIp("")).toBe(true);
    });
  });

  describe("assertRequestUrlIsPublic with IPv6 spellings of internal hosts", () => {
    it.each([
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[::ffff:127.0.0.1]:5001/api",
      "http://[0:0:0:0:0:ffff:7f00:1]/",
      "http://[::ffff:a00:1]/",
      "http://[64:ff9b::a9fe:a9fe]/",
      "http://[2002:a9fe:a9fe::1]/",
    ])("rejects %s", (url) => {
      expect(() => assertRequestUrlIsPublic(url)).toThrow(SsrfBlockedError);
    });

    it("rejects IPv4 spellings the URL parser normalizes", () => {
      for (const url of [
        "http://2130706433/", // decimal 127.0.0.1
        "http://0x7f.0.0.1/", // hex
        "http://017700000001/", // octal
        "http://127.1/", // short form
      ]) {
        expect(() => assertRequestUrlIsPublic(url)).toThrow(SsrfBlockedError);
      }
    });
  });
});
