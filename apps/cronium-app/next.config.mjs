import createNextIntlPlugin from "next-intl/plugin";
import { env } from "./src/env.mjs";
import crypto from "crypto";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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
  env: {
    PUBLIC_APP_URL: env.PUBLIC_APP_URL,
  },
  webpack: (config, { isServer, dev }) => {
    // Handle SSH binary modules properly
    config.externals = [...(config.externals || []), "ssh2"];

    // Handle xterm.js packages properly for dynamic imports
    if (!isServer) {
      // This fixes Node.js modules used in browser context
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
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
  experimental: {
    // Enable Partial Prerendering (PPR) only in production
    // PPR causes severe performance issues in development
    ppr: process.env.NODE_ENV === "production",
    // Optimize package imports
    optimizePackageImports: [
      "@radix-ui/react-*",
      "lucide-react",
      "@/components/ui/*",
    ],
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
        source: "/:lang/docs/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // Cache landing page (with PPR)
        source: "/:lang",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // No cache for dynamic pages (dashboard, auth, etc.)
        source: "/:lang/(dashboard|auth)/:path*",
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

export default withBundleAnalyzer(withNextIntl(nextConfig));
