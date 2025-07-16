# Code Splitting & Performance Optimization Plan

## Overview

This plan outlines a comprehensive approach to improve Cronium's performance through code splitting, lazy loading, server components, streaming, and partial prerendering. The implementation is divided into phases with clear objectives, tasks, and success criteria.

## Goals

1. Reduce initial bundle size by 50-70% (from ~3.5MB to <1MB)
2. Improve Time to Interactive (TTI) by implementing progressive loading
3. Convert client components to server components where appropriate
4. Implement streaming and suspense boundaries for better perceived performance
5. Enable partial prerendering for optimal static/dynamic content mix

## Key Findings from Analysis

- **Current Bundle**: ~3.5MB estimated (uncompressed)
- **Heavy Dependencies**: ~2.8MB (80% of bundle)
  - Monaco Editor: ~2MB
  - XTerm.js + addons: ~500KB
  - XyFlow/ReactFlow: ~300KB
  - Recharts: ~200KB
- **Component Counts**:
  - 7 components using Monaco Editor
  - 2 components using Terminal
  - 8 components using XyFlow/ReactFlow
  - Multiple components using charts
- **Largest Component**: WorkflowCanvas.tsx (1108 lines)

## Phase 1: Code Splitting Foundation (2-3 days)

### Objectives

- Identify and split heavy components
- Implement dynamic imports for non-critical features
- Create loading states for lazy-loaded components

### Tasks

#### 1.1 Component Analysis

- [x] Audit all components to identify heavy dependencies
- [x] Create inventory of components using Monaco Editor, XTerm.js, XyFlow
- [x] Measure current bundle sizes using Next.js Bundle Analyzer
- [x] Identify components that can be lazy loaded

#### 1.2 Implement Dynamic Imports

- [x] Convert Monaco Editor imports to dynamic loading
- [x] Convert Terminal component to dynamic loading
- [x] Convert WorkflowBuilder (XyFlow) to dynamic loading
- [x] Convert Action Builder components to dynamic loading
- [x] Convert chart/visualization components (recharts) to dynamic loading
- [x] Convert AI Script Assistant to dynamic loading
- [x] Convert heavy form components (EventForm, ConditionalActionsSection) to dynamic loading
- [x] Add appropriate loading skeletons for each component
- [x] Extract XTerm CSS import to be loaded only with Terminal component

#### 1.3 Route-based Code Splitting

- [x] Implement route groups for dashboard sections
- [x] Split authentication pages from main app bundle
- [x] Separate admin features into their own bundle
- [x] Configure webpack to optimize chunk splitting

### Success Criteria

- Initial JavaScript bundle reduced by at least 40%
- All heavy components load on-demand
- No regression in functionality

## Phase 2: Server Components Migration (4-5 days)

### Objectives

- Convert client-side rendered pages to server components
- Reduce client-side JavaScript requirements
- Improve initial page load performance

### Tasks

#### 2.1 Page Analysis

- [x] Audit all pages and components for "use client" directives
- [x] Identify pages and components that can be server components
- [x] Map data fetching patterns for each page
- [x] Plan migration order (start with simplest pages and components)

#### 2.2 Dashboard Pages Migration

- [x] Convert Events list page to server component
- [x] Convert Workflows list page to server component
- [x] Convert Servers list page to server component
- [~] Convert Logs viewing pages to server component (deferred - real-time requirements)
- [~] Convert Settings pages to server component (deferred - complex forms)

#### 2.3 Data Fetching Optimization

- [x] Replace client-side tRPC queries with server-side calls
- [x] Implement proper error boundaries
- [x] Add appropriate metadata for SEO
- [x] Ensure authentication works with server components

#### 2.4 Interactive Features Isolation

- [x] Extract interactive parts into client components
- [x] Create minimal client component wrappers
- [x] Implement proper component composition
- [x] Maintain type safety across boundaries

### Success Criteria

- 70% of dashboard pages are server components
- Reduced Time to First Byte (TTFB)
- Maintained interactivity where needed

## Phase 3: Streaming & Suspense Implementation (3-4 days)

### Objectives

- Implement streaming for progressive page loading
- Add suspense boundaries for better UX
- Create consistent loading patterns

### Tasks

#### 3.1 Layout Streaming

- [x] Add suspense boundaries to root layout
- [x] Implement streaming for dashboard layout
- [x] Create header/navigation skeleton components
- [x] Stream sidebar separately from main content

#### 3.2 Content Streaming

- [x] Implement suspense for data tables
- [x] Add streaming to event details pages
- [x] Create suspense boundaries for charts/stats
- [x] Stream log outputs progressively

#### 3.3 Loading State Standardization

- [x] Create reusable skeleton components
- [x] Implement consistent loading patterns
- [x] Add loading.tsx files for all routes
- [x] Create LoadingBoundary wrapper component

#### 3.4 Error Handling

- [x] Implement error.tsx files for all routes
- [x] Create fallback UI for failed suspense
- [x] Add retry mechanisms for failed streams
- [x] Ensure graceful degradation

### Success Criteria

- All pages show content progressively
- Loading states are consistent and informative
- No layout shift during streaming

## Phase 4: Partial Prerendering Setup (2-3 days)

### Objectives

- Enable Next.js Partial Prerendering
- Optimize static/dynamic content split
- Improve cache efficiency

### Tasks

#### 4.1 PPR Configuration

- [x] Enable experimental PPR in next.config.mjs
- [x] Identify pages suitable for PPR
- [x] Mark pages with experimental_ppr flag
- [x] Configure appropriate cache headers

#### 4.2 Static Shell Implementation

- [x] Create static shells for dashboard pages
- [x] Define dynamic regions within pages
- [x] Implement proper suspense boundaries
- [x] Optimize static content extraction

#### 4.3 Cache Strategy

- [x] Configure ISR for semi-static content
- [x] Set appropriate revalidation times
- [x] Implement cache tags for invalidation
- [x] Add stale-while-revalidate patterns

### Human Intervention Required

- [ ] Verify PPR compatibility with current Next.js version
- [ ] Test PPR behavior in production environment
- [ ] Monitor cache hit rates and adjust strategy

### Success Criteria

- PPR enabled for suitable pages
- Improved cache hit rates
- Faster perceived performance

## Phase 5: Bundle Optimization (2 days)

### Objectives

- Optimize remaining bundle size
- Implement advanced splitting strategies
- Remove unused code

### Tasks

#### 5.1 Dependencies Audit

- [x] Analyze package.json for unused dependencies
- [x] Identify duplicate dependencies
- [x] Find lighter alternatives for heavy packages
- [x] Remove development dependencies from production

#### 5.2 Tree Shaking Optimization

- [x] Ensure proper ES modules usage
- [x] Configure webpack for aggressive tree shaking
- [x] Remove unused exports
- [x] Optimize icon and utility imports

#### 5.3 Polyfill Optimization

- [x] Audit current polyfills
- [x] Implement conditional polyfill loading
- [x] Use modern browser targets
- [x] Remove unnecessary transpilation

#### 5.4 Asset Optimization

- [x] Implement next/font for optimal font loading
- [x] Optimize all images with next/image
- [x] Configure appropriate image formats
- [x] Add resource hints for critical assets

### Success Criteria

- Total bundle size reduced by 60%+
- No unnecessary code in production
- Optimal asset loading strategy

## Phase 6: Additional Optimizations (2 days)

### Objectives

- Optimize component-specific dependencies
- Reduce duplicate code across bundles
- Implement granular loading strategies

### Tasks

#### 6.1 Component-Specific Optimizations

- [x] Create separate Monaco wrapper for read-only usage (EventDetailsTab)
- [x] Split WorkflowCanvas (1108 lines) into smaller sub-components
- [x] Optimize Radix UI imports to load only used components
- [x] Implement icon sprite sheets or dynamic icon loading

#### 6.2 Shared Dependencies Optimization

- [ ] Create shared chunks for commonly used heavy libraries
- [ ] Implement module federation for micro-frontend architecture
- [ ] Optimize react-hook-form usage with lazy field registration
- [ ] Bundle similar components together (all form components, all visualization components)

#### 6.3 Progressive Enhancement

- [ ] Implement progressive loading for complex forms (load sections as needed)
- [ ] Add intersection observer for below-fold component loading
- [ ] Create lightweight placeholders for heavy components
- [ ] Implement predictive preloading based on user navigation patterns

### Success Criteria

- Further 10-15% bundle reduction
- Improved perceived performance
- No duplicate dependencies across chunks

## Phase 7: Performance Monitoring (2 days)

### Objectives

- Implement comprehensive performance monitoring
- Set up alerting for regressions
- Create performance budgets

### Tasks

#### 7.1 Metrics Implementation

- [ ] Add Web Vitals tracking
- [ ] Implement custom performance marks
- [ ] Set up Real User Monitoring (RUM)
- [ ] Create performance dashboards

#### 7.2 Build-time Checks

- [ ] Add bundle size checks to CI/CD
- [ ] Implement lighthouse CI
- [ ] Create performance budgets
- [ ] Add automated regression alerts

#### 7.3 Runtime Monitoring

- [ ] Track component render times
- [ ] Monitor API response times
- [ ] Log slow database queries
- [ ] Identify performance bottlenecks

### Human Intervention Required

- [ ] Choose and configure monitoring service
- [ ] Set up alerting thresholds
- [ ] Create performance reporting process

### Success Criteria

- All key metrics tracked
- Automated performance regression detection
- Clear visibility into performance trends

## Implementation Timeline

- **Week 1**: Phase 1 (Code Splitting) + Phase 2 start
- **Week 2**: Complete Phase 2 + Phase 3
- **Week 3**: Phase 4 + Phase 5
- **Week 4**: Phase 6 (Additional Optimizations)
- **Week 5**: Phase 7 (Monitoring) + Testing & Refinement

## Risk Mitigation

1. **Type Safety**: Ensure dynamic imports maintain TypeScript support
2. **SEO Impact**: Verify server components don't break meta tags
3. **Authentication**: Test auth flows with server components
4. **WebSocket Compatibility**: Ensure real-time features work with new architecture
5. **Development Experience**: Maintain fast refresh and debugging capabilities

## Success Metrics

1. **Performance Metrics**
   - Initial bundle size: < 200KB (currently ~3.5MB estimated)
   - Heavy dependencies lazy loaded: ~2.8MB moved to on-demand
   - LCP: < 2.5s
   - TTI: < 3.5s (improve by 2-3s)
   - FID: < 100ms

2. **Technical Metrics**
   - Server component adoption: > 70%
   - Code splitting coverage: > 90%
   - Cache hit rate: > 80%

3. **Developer Metrics**
   - No increase in build times
   - Maintained type safety
   - Clear component boundaries

## Post-Implementation Tasks

1. Document new patterns and best practices
2. Update developer onboarding guides
3. Create performance optimization checklist
4. Set up regular performance reviews
5. Plan next optimization phases (database, caching)

## Notes

- Priority should be given to user-facing performance improvements
- Each phase should be tested thoroughly before moving to the next
- Performance gains should be measured and documented
- Rollback plans should be in place for each major change
- Consider feature flags for gradual rollout of optimizations
