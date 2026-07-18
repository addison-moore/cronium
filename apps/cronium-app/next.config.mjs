import { env } from "./src/env.mjs";
import crypto from "crypto";

// Bundle analyzer configuration (optional)
let withBundleAnalyzer = (config) => config;
try {
  const bundleAnalyzer = await import("@next/bundle-analyzer");
  withBundleAnalyzer = bundleAnalyzer.default({
    enabled: process.env.ANALYZE === "true",
  });
} catch (e) {
  // Bundle analyzer not installed, skip it
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: [
      "@radix-ui/react-*",
      "lucide-react",
      "@/components/ui/*",
    ],
  },
  env: {
    PUBLIC_APP_URL: env.PUBLIC_APP_URL,
  },
  webpack: (config, { isServer, dev }) => {
    // Handle SSH binary modules properly. mysql2 (SQL tool driver), mongodb
    // (MongoDB tool driver) and @anthropic-ai/sdk (AI tool provider) are
    // externalized too: they are only ever loaded via server-executed dynamic
    // imports, and they use `node:`-scheme and subpath builtins (e.g.
    // timers/promises, node:path) the client webpack can't resolve —
    // externalizing keeps them out of the client trace entirely. Scoped
    // package names must use the object/commonjs form: the bare-string form
    // emits `module.exports = @anthropic-ai/sdk`, which is not parseable JS.
    config.externals = [
      ...(config.externals || []),
      "ssh2",
      "mysql2/promise",
      "mysql2",
      "mongodb",
      { "@anthropic-ai/sdk": "commonjs @anthropic-ai/sdk" },
    ];

    // Handle xterm.js packages properly for dynamic imports
    if (!isServer) {
      // This fixes Node.js modules used in browser context. Some server-only
      // modules (nodemailer, pg) are reachable from client components only via
      // server-executed dynamic imports (e.g. tool plugin execute()); stub the
      // Node builtins they pull so the client build resolves them to empty.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        dns: false,
        "dns/promises": false,
        child_process: false,
        // pg >= 8.17 reaches for util/types; it is server-only.
        "util/types": false,
        // pg's native binding is an optional dependency we don't install; pg
        // falls back to pure JS. Stub it so the client trace doesn't warn.
        "pg-native": false,
      };

      // Only apply optimization in production
      if (!dev) {
        // Optimize chunk splitting and tree shaking
        config.optimization = {
          ...config.optimization,
          sideEffects: false,
          minimize: true,
          splitChunks: {
            chunks: "all",
            cacheGroups: {
              default: false,
              vendors: false,
              // Framework chunk
              framework: {
                name: "framework",
                chunks: "all",
                test: /[\\/]node_modules[\\/](react|react-dom|scheduler|next)[\\/]/,
                priority: 40,
                enforce: true,
              },
              // Common libraries used across the app
              lib: {
                test(module) {
                  return (
                    module.size() > 160000 &&
                    /node_modules[/\\]/.test(module.identifier())
                  );
                },
                name(module) {
                  const hash = crypto.createHash("sha1");
                  hash.update(module.identifier());
                  return hash.digest("hex").substring(0, 8);
                },
                priority: 30,
                minChunks: 1,
                reuseExistingChunk: true,
              },
              // UI components chunk
              ui: {
                name: "ui",
                test: /[\\/]node_modules[\\/](@radix-ui|lucide-react|react-icons)[\\/]/,
                priority: 20,
              },
              // Form libraries chunk
              forms: {
                name: "forms",
                test: /[\\/]node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/,
                priority: 20,
              },
              // Shared components chunk
              commons: {
                name: "commons",
                minChunks: 2,
                priority: 10,
                reuseExistingChunk: true,
              },
            },
          },
        };
      }

      // Configure module rules for better tree shaking
      // Removed sideEffects: false rule to avoid conflicts
      // config.module.rules.push({
      //   test: /\.(js|mjs|jsx|ts|tsx)$/,
      //   sideEffects: false,
      // });

      // Ensure xterm packages are properly bundled for client-side
      // Remove explicit aliases as they can cause bundling issues
    } else {
      // For server-side, ensure xterm packages are external (not bundled)
      const originalExternals = config.externals || [];
      config.externals = [
        ...originalExternals,
        "@xterm/xterm",
        "@xterm/addon-fit",
        "@xterm/addon-unicode11",
        "@xterm/addon-web-links",
      ];
    }

    return config;
  },
  serverExternalPackages: [
    "ssh2",
    "node-ssh",
    "mysql2",
    "mongodb",
    "@anthropic-ai/sdk",
    "handlebars",
    "@xterm/xterm",
    "@xterm/addon-fit",
    "@xterm/addon-unicode11",
    "@xterm/addon-web-links",
  ],
  eslint: {
    // Disable ESLint during builds for now
    ignoreDuringBuilds: true,
  },
  reactStrictMode: true,
  output: "standalone",
  images: {
    formats: ["image/avif", "image/webp"],
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async rewrites() {
    return [
      // MCP OAuth 2.1 discovery (RFC 8414 / RFC 9728). The handlers live under
      // /api/mcp/oauth/metadata so tsc/eslint pick them up; expose the spec URLs.
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/mcp/oauth/metadata/authorization-server",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/mcp/oauth/metadata/protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/api/mcp",
        destination: "/api/mcp/oauth/metadata/protected-resource",
      },
    ];
  },
  async headers() {
    return [
      {
        // Cache static assets (images, fonts, etc.)
        source: "/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Cache documentation pages (with PPR)
        source: "/docs/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // Cache landing page (with PPR)
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // No cache for dynamic pages (dashboard, auth, etc.)
        source: "/(dashboard|auth)/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, must-revalidate",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
          {
            key: "Expires",
            value: "0",
          },
        ],
      },
      {
        // API routes should not be cached
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
