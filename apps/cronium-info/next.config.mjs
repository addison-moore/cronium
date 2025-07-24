import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // output: 'export', // Static export for hosting - temporarily disabled for dev
  images: {
    unoptimized: true, // Required for static export
  },
  // Disable features that require a Node.js server
  experimental: {
    // These are already disabled by default with output: 'export'
  },
};

export default withNextIntl(nextConfig);