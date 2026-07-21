import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  staticSecurityHeaders,
} from "@/lib/security/security-headers";

describe("buildContentSecurityPolicy", () => {
  const csp = buildContentSecurityPolicy("abc123");

  it("uses a per-request nonce with strict-dynamic and no unsafe-* for scripts", () => {
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("blocks framing, plugins, and base-tag injection", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("allows Monaco workers and Socket.IO connections", () => {
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("connect-src 'self' ws: wss:");
  });
});

describe("staticSecurityHeaders", () => {
  it("sets the standard hardening headers", () => {
    const headers = staticSecurityHeaders(true);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("geolocation=()");
  });

  it("only sends HSTS in production", () => {
    expect(staticSecurityHeaders(true)["Strict-Transport-Security"]).toContain(
      "max-age=",
    );
    expect(
      staticSecurityHeaders(false)["Strict-Transport-Security"],
    ).toBeUndefined();
  });
});

describe("applySecurityHeaders", () => {
  it("omits CSP when applyCsp is false (development)", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, {
      nonce: "n",
      isProduction: false,
      applyCsp: false,
    });
    expect(headers.get("Content-Security-Policy")).toBeNull();
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets CSP with the nonce when applyCsp is true", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, {
      nonce: "xyz",
      isProduction: true,
      applyCsp: true,
    });
    expect(headers.get("Content-Security-Policy")).toContain("'nonce-xyz'");
    expect(headers.get("Strict-Transport-Security")).toBeTruthy();
  });
});
