const createNextIntlPlugin = require('next-intl/plugin');
 
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
 
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Handle SSH binary modules properly
    config.externals = [...(config.externals || []), 'ssh2'];
    
    // Match next.js's behavior for handling web vs. node modules
    if (!isServer) {
      // This fixes Node.js modules used in browser context
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    
    return config;
  },
  serverExternalPackages: [
    'ssh2',
    'node-ssh'
  ],
  eslint: {
    // Disable ESLint during builds for now
    ignoreDuringBuilds: true,
  },
  reactStrictMode: true,
};

module.exports = withNextIntl(nextConfig);