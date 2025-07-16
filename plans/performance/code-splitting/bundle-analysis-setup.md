# Bundle Analysis Setup

## Overview

This document describes the setup for analyzing bundle sizes in the Cronium application using Next.js Bundle Analyzer.

## Installation

```bash
pnpm add -D @next/bundle-analyzer
```

## Configuration

### next.config.mjs

Added bundle analyzer configuration:

```javascript
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

// Wrap the config export
export default withBundleAnalyzer(withNextIntl(nextConfig));
```

### package.json

Added analyze script:

```json
"analyze": "ANALYZE=true next build"
```

## Usage

To analyze the bundle:

```bash
pnpm analyze
```

This will:

1. Build the application in production mode
2. Generate bundle analysis reports
3. Open three HTML reports in your browser:
   - Client-side bundles
   - Server-side bundles
   - Edge runtime bundles (if applicable)

## What to Look For

### Large Dependencies

- Monaco Editor (~2MB)
- XTerm.js (~500KB)
- XyFlow/ReactFlow (~300KB)
- Other UI libraries

### Bundle Splitting

- Check if code is properly split by route
- Look for duplicate code across bundles
- Identify shared chunks that could be optimized

### Unused Code

- Libraries imported but not used
- Dead code that wasn't tree-shaken
- Development-only code in production

## Baseline Measurements

To establish baseline measurements:

1. Run `pnpm analyze`
2. Save screenshots of the reports
3. Note the total bundle sizes:
   - First Load JS (critical metric)
   - Shared chunks size
   - Page-specific bundle sizes

## Next Steps

After analysis:

1. Identify the largest contributors to bundle size
2. Prioritize components for lazy loading
3. Look for opportunities to replace heavy dependencies
4. Check for duplicate dependencies or conflicting versions

## Notes

- The analyzer runs only when ANALYZE=true is set
- Reports are generated in the .next directory
- Analysis adds overhead to build time, so it's not enabled by default
- Results may vary between development and production builds
