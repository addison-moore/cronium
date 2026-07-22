/** @type {import('next').NextConfig} */

// Browser security-header baseline (security plan Phase 4.3), mirroring the app.
// HSTS is only meaningful behind TLS, so it is emitted for production builds.
// The CSP here intentionally sets only the directives that harden without any
// risk of breaking the marketing/docs site's own bundled scripts: framing,
// plugin, base-tag, and form-action controls. (A full nonce-based script CSP
// like the app's would need runtime verification against the info site's
// client components and is tracked as a follow-up.)
const isProduction = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value:
      "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]
    : []),
];

const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
