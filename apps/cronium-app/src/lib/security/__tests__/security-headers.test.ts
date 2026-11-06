import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  staticSecurityHeaders,
} from "@/lib/security/security-headers";

describe("buildContentSecurityPolicy", () => {
  const csp = buildContentSecurityPolicy("abc123");
  const directive = (name: string) =>
    csp.split("; ").find((d) => d.startsWith(`${name} `));

  it("allows scripts by per-request nonce and from our own origin, nothing else", () => {
    expect(directive("script-src")).toBe("script-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("does not trust scripts that a nonced script inserts", () => {
    // 'strict-dynamic' lets a nonced script load code from any origin. It is how
    // Monaco's CDN build ran in the authenticated origin without anyone noticing.
    expect(csp).not.toContain("strict-dynamic");
  });

  it("blocks framing, plugins, and base-tag injection", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("keeps workers on our own origin and allows Socket.IO connections", () => {
    // Monaco's workers are bundled chunks, so nothing needs blob: workers.
    expect(directive("worker-src")).toBe("worker-src 'self'");
    expect(directive("connect-src")).toBe("connect-src 'self' ws: wss:");
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
