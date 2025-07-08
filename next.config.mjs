import createNextIntlPlugin from "next-intl/plugin";
import { env } from "./src/env.mjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
  },
  webpack: (config, { isServer }) => {
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
};

export default withNextIntl(nextConfig);
