import { resolveClientIp } from "@/lib/security/client-ip";

const ORIGINAL = process.env.TRUSTED_PROXY_HOPS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = ORIGINAL;
});

function setHops(value: string | undefined) {
  if (value === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = value;
}

describe("resolveClientIp — no trusted proxy (default)", () => {
  beforeEach(() => setHops("0"));

  it("ignores X-Forwarded-For entirely and uses the direct peer", () => {
    expect(resolveClientIp("1.2.3.4, 5.6.7.8", "9.9.9.9")).toBe("9.9.9.9");
  });

  it("returns null when there is no direct peer", () => {
    expect(resolveClientIp("1.2.3.4", undefined)).toBeNull();
  });

  it("a spoofed forwarded header cannot set the IP", () => {
    // Attacker prepends a fake IP; with no trusted proxy it is ignored.
    expect(resolveClientIp("evil-spoof, 1.1.1.1", "10.0.0.1")).toBe("10.0.0.1");
  });
});

describe("resolveClientIp — one trusted proxy hop", () => {
  beforeEach(() => setHops("1"));

  it("reads the entry the trusted proxy appended (rightmost)", () => {
    // Real client 203.0.113.5, proxy appends nothing extra: single entry.
    expect(resolveClientIp("203.0.113.5", "127.0.0.1")).toBe("203.0.113.5");
  });

  it("an attacker-prepended entry does not win", () => {
    // Attacker sends XFF: "1.1.1.1"; the trusted proxy appends the real peer.
    expect(resolveClientIp("1.1.1.1, 203.0.113.5", "127.0.0.1")).toBe(
      "203.0.113.5",
    );
  });

  it("fails closed (null) when the chain is shorter than trusted hops", () => {
    setHops("2");
    expect(resolveClientIp("203.0.113.5", "127.0.0.1")).toBeNull();
  });

  it("strips a port from an IPv4:port entry", () => {
    expect(resolveClientIp("203.0.113.5:44321", "127.0.0.1")).toBe(
      "203.0.113.5",
    );
  });

  it("falls back to the direct peer when the header is absent", () => {
    expect(resolveClientIp(null, "198.51.100.7")).toBe("198.51.100.7");
  });
});

describe("resolveClientIp — hardening", () => {
  it("treats an out-of-range hop config as no trusted proxy", () => {
    setHops("not-a-number");
    expect(resolveClientIp("1.1.1.1", "2.2.2.2")).toBe("2.2.2.2");
  });

  it("clamps absurd hop counts and fails closed on short chains", () => {
    setHops("99");
    expect(resolveClientIp("1.1.1.1, 2.2.2.2", "3.3.3.3")).toBeNull();
  });
});
