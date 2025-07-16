# Dependencies Audit Report

## Overview

This document contains a comprehensive audit of all dependencies in package.json, identifying unused packages, duplicates, and opportunities for optimization.

## Unused Dependencies Found

### Can be removed immediately:

1. **archiver** (^7.0.1) - Only type definitions exist, no actual usage
2. **bufferutil** (^4.0.9) - No imports found (optional ws dependency)
3. **memoizee** (^0.4.17) - No imports found
4. **systeminformation** (^5.27.7) - Never imported despite comments
5. **connect-pg-simple** (^10.0.0) - No imports found (session storage)
6. **openid-client** (^6.6.2) - No imports found (OAuth)
7. **node-cron** (^4.2.1) - Using node-schedule instead

### Should be replaced:

1. **react-feather** (^2.0.10) - Only used for X icon, replace with lucide-react

## Duplicate/Overlapping Dependencies

### Scheduling Libraries:

- **node-cron** AND **node-schedule** - Only node-schedule is used
- Action: Remove node-cron

### Icon Libraries:

- **lucide-react** (175+ files using it)
- **react-icons** (used extensively)
- **react-feather** (only 1 usage)
- Action: Keep lucide-react and react-icons, remove react-feather

### Authentication:

- **next-auth** (primary auth)
- **passport** + **passport-local** (used for local strategy)
- **express-session** (used with passport)
- Action: Keep all - they work together

## Heavy Dependencies Analysis

### Largest Dependencies:

1. **@monaco-editor/react** (~2MB) - Essential for code editing
2. **@xterm/xterm** + addons (~500KB) - Essential for terminal
3. **@xyflow/react** (~300KB) - Essential for workflow canvas
4. **@sendgrid/mail** - Email service
5. **@slack/web-api** - Slack integration
6. **openai** - AI features

### Lighter Alternatives Considered:

#### Monaco Editor Alternatives:

- **CodeMirror 6** - Smaller (~200-400KB) but less features
- **Ace Editor** - Similar size, less TypeScript support
- **Recommendation**: Keep Monaco for now, lazy load it

#### XTerm Alternatives:

- **hterm** - Google's terminal, less features
- **Recommendation**: Keep XTerm, it's already optimized

#### XyFlow Alternatives:

- **React Flow** - Same library (XyFlow is the new name)
- **Cytoscape.js** - Different API, migration cost high
- **Recommendation**: Keep XyFlow

## Development Dependencies in Production

These dev dependencies might be incorrectly bundled:

1. **ts-node** - Should not be in production
2. **tsx** - Should not be in production
3. **@types/** packages - TypeScript only

## Bundle Size Impact

### Estimated sizes of major dependencies:

```
@monaco-editor/react: ~2MB
@xterm/xterm + addons: ~500KB
@xyflow/react: ~300KB
@tanstack/react-query: ~50KB
@trpc/*: ~100KB total
@radix-ui/*: ~200KB total (tree-shakeable)
lucide-react: ~50KB (tree-shakeable)
react-icons: ~100KB (tree-shakeable)
date-fns: ~75KB (tree-shakeable)
```

## Recommendations

### Immediate Actions:

1. Remove unused dependencies (saves ~200KB):
   - archiver
   - bufferutil
   - memoizee
   - systeminformation
   - connect-pg-simple
   - openid-client
   - node-cron

2. Replace react-feather with lucide-react X icon

### Optimization Strategies:

1. Ensure tree-shaking for:
   - @radix-ui/\* components
   - lucide-react icons
   - react-icons
   - date-fns functions

2. Consider lazy loading for:
   - @monaco-editor/react (already done in Phase 1)
   - @xterm/xterm (already done in Phase 1)
   - @xyflow/react (already done in Phase 1)

3. Review production build for dev dependencies

### Future Considerations:

1. Monitor bundle size after removing dependencies
2. Consider replacing heavy libraries only if:
   - Performance issues persist
   - Lighter alternatives provide same features
   - Migration cost is justified

## Script to Remove Unused Dependencies

```bash
# Remove unused dependencies
pnpm remove archiver bufferutil memoizee systeminformation connect-pg-simple openid-client node-cron react-feather

# Also remove their types if present
pnpm remove -D @types/archiver @types/memoizee @types/connect-pg-simple @types/node-cron
```
