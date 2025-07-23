/**
 * Consistent loading patterns for the Cronium application
 * This file provides standardized loading implementations
 */

import { Suspense } from "react";
import {
  PageLoadingBoundary,
  SectionLoadingBoundary,
} from "./loading-boundary";
import {
  CardSkeleton,
  PageHeaderSkeleton,
  DashboardSkeleton,
  DetailPageSkeleton,
} from "./skeleton-library";

// Define missing skeleton components
const TableSkeleton = ({
  rows = 5,
  columns = 3,
}: {
  rows?: number;
  columns?: number;
}) => (
  <div className="w-full">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="border-border flex gap-4 border-b p-4">
        {Array.from({ length: columns }).map((_, j) => (
          <div
            key={j}
            className="h-4 flex-1 animate-pulse rounded bg-gray-200"
          />
        ))}
      </div>
    ))}
  </div>
);

const FormSkeleton = () => (
  <div className="space-y-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="space-y-2">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
        <div className="h-10 animate-pulse rounded bg-gray-200" />
      </div>
    ))}
  </div>
);

// ============================================
// Pattern 1: Page-Level Loading
// ============================================

/**
 * Use for entire page loads with authentication and data fetching
 */
export function PageLoadingPattern() {
  return (
    <PageLoadingBoundary>
      <div>{/* Your async page content */}</div>
    </PageLoadingBoundary>
  );
}

// Example implementation:
export async function ExamplePageWithLoading() {
  return (
    <div className="container mx-auto p-4">
      <PageHeaderSkeleton />
      <Suspense fallback={<DashboardSkeleton />}>
        {/* Async content that loads data */}
      </Suspense>
    </div>
  );
}

// ============================================
// Pattern 2: Section-Level Loading
// ============================================

/**
 * Use for independent sections that can load separately
 */
export function SectionLoadingPattern() {
  return (
    <>
      {/* Header loads immediately */}
      <PageHeaderSkeleton />

      {/* Each section loads independently */}
      <div className="grid gap-6 md:grid-cols-2">
        <SectionLoadingBoundary fallback={<CardSkeleton />}>
          <div>{/* Section 1 async content */}</div>
        </SectionLoadingBoundary>

        <SectionLoadingBoundary fallback={<CardSkeleton />}>
          <div>{/* Section 2 async content */}</div>
        </SectionLoadingBoundary>
      </div>
    </>
  );
}

// ============================================
// Pattern 3: Progressive Data Loading
// ============================================

/**
 * Use for tables and lists that need pagination
 */
export function ProgressiveTablePattern() {
  return (
    <div className="space-y-4">
      {/* Filters load first */}
      <div className="flex gap-2">{/* Filter components */}</div>

      {/* Table loads with skeleton */}
      <Suspense fallback={<TableSkeleton rows={10} columns={5} />}>
        {/* Async table data */}
      </Suspense>

      {/* Pagination can be shown immediately */}
      <div className="flex justify-between">{/* Pagination controls */}</div>
    </div>
  );
}

// ============================================
// Pattern 4: Form with Dynamic Fields
// ============================================

/**
 * Use for forms that load configuration dynamically
 */
export function DynamicFormPattern() {
  return (
    <form className="space-y-4">
      {/* Static fields render immediately */}
      <div className="space-y-4">{/* Basic form fields */}</div>

      {/* Dynamic fields load separately */}
      <Suspense fallback={<FormSkeleton />}>
        {/* Async form fields based on configuration */}
      </Suspense>

      {/* Submit button always visible */}
      <div className="flex justify-end">
        <button type="submit">Submit</button>
      </div>
    </form>
  );
}

// ============================================
// Pattern 5: Dashboard Grid Loading
// ============================================

/**
 * Use for dashboard with multiple independent widgets
 */
export function DashboardGridPattern() {
  return (
    <div className="space-y-6">
      {/* Header loads immediately */}
      <h1>Dashboard</h1>

      {/* Stats cards load together */}
      <Suspense
        fallback={
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} showHeader={false} />
            ))}
          </div>
        }
      >
        {/* Async stats cards */}
      </Suspense>

      {/* Main content sections load independently */}
      <div className="grid gap-6 md:grid-cols-2">
        <Suspense fallback={<CardSkeleton />}>
          {/* Chart/graph section */}
        </Suspense>

        <Suspense fallback={<TableSkeleton rows={5} />}>
          {/* Recent activity table */}
        </Suspense>
      </div>
    </div>
  );
}

// ============================================
// Pattern 6: Detail Page with Tabs
// ============================================

/**
 * Use for detail pages with multiple tab sections
 */
export function TabbedDetailPattern() {
  return (
    <div className="space-y-6">
      {/* Header with basic info loads first */}
      <Suspense fallback={<PageHeaderSkeleton showBreadcrumb />}>
        {/* Async header with entity details */}
      </Suspense>

      {/* Tab content loads on demand */}
      <div className="space-y-4">
        <div className="border-border border-b">
          {/* Tab buttons render immediately */}
        </div>

        <Suspense fallback={<DetailPageSkeleton />}>
          {/* Active tab content */}
        </Suspense>
      </div>
    </div>
  );
}

// ============================================
// Pattern 7: Infinite Scroll Loading
// ============================================

/**
 * Use for lists with infinite scroll
 */
export function InfiniteScrollPattern() {
  return (
    <div className="space-y-4">
      {/* Initial items */}
      <div className="space-y-2">{/* Rendered items */}</div>

      {/* Loading indicator for next page */}
      <div className="flex justify-center py-4">
        <Suspense
          fallback={
            <div className="text-center">
              <span className="text-muted-foreground">Loading more...</span>
            </div>
          }
        >
          {/* Next page items */}
        </Suspense>
      </div>
    </div>
  );
}

// ============================================
// Pattern 8: Modal/Dialog Loading
// ============================================

/**
 * Use for modals that load content dynamically
 */
export function ModalLoadingPattern() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="bg-background w-full max-w-md rounded-lg p-6">
        <Suspense
          fallback={
            <div className="space-y-4">
              <div className="bg-muted h-6 w-48 animate-pulse rounded" />
              <div className="bg-muted h-32 w-full animate-pulse rounded" />
              <div className="flex justify-end gap-2">
                <div className="bg-muted h-10 w-20 animate-pulse rounded" />
                <div className="bg-muted h-10 w-24 animate-pulse rounded" />
              </div>
            </div>
          }
        >
          {/* Async modal content */}
        </Suspense>
      </div>
    </div>
  );
}

// ============================================
// Pattern 9: Search Results Loading
// ============================================

/**
 * Use for search interfaces with results
 */
export function SearchResultsPattern() {
  return (
    <div className="space-y-4">
      {/* Search input always visible */}
      <div className="relative">
        <input type="search" placeholder="Search..." />
      </div>

      {/* Results load with skeleton */}
      <Suspense
        fallback={
          <div className="space-y-2">
            <div className="text-muted-foreground">Searching...</div>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <CardSkeleton key={i} showHeader={false} />
              ))}
            </div>
          </div>
        }
      >
        {/* Search results */}
      </Suspense>
    </div>
  );
}

// ============================================
// Pattern 10: Nested Loading States
// ============================================

/**
 * Use for complex UIs with nested async dependencies
 */
export function NestedLoadingPattern() {
  return (
    <Suspense fallback={<PageHeaderSkeleton />}>
      {/* Level 1: Page header */}
      <Suspense fallback={<CardSkeleton />}>
        {/* Level 2: Main content */}
        <div className="space-y-4">
          <Suspense fallback={<TableSkeleton rows={5} />}>
            {/* Level 3: Nested data table */}
          </Suspense>
        </div>
      </Suspense>
    </Suspense>
  );
}

// ============================================
// Loading State Guidelines
// ============================================

/**
 * Best Practices:
 *
 * 1. Always show immediate feedback
 *    - Use skeletons that match the expected content layout
 *    - Avoid generic spinners for content areas
 *
 * 2. Load progressively
 *    - Critical content first (headers, navigation)
 *    - Heavy content later (charts, tables)
 *    - Independent sections in parallel
 *
 * 3. Maintain layout stability
 *    - Skeletons should have same dimensions as loaded content
 *    - Prevent layout shift during loading
 *
 * 4. Handle errors gracefully
 *    - Use LoadingBoundary for error handling
 *    - Provide retry mechanisms
 *    - Show helpful error messages
 *
 * 5. Optimize perceived performance
 *    - Use deferred loading for non-critical content
 *    - Implement streaming where possible
 *    - Show partial results early
 */

// ============================================
// Utility Functions
// ============================================

/**
 * Helper to create consistent loading states
 */
export function createLoadingState(
  type: "page" | "section" | "inline",
  customSkeleton?: React.ReactNode,
) {
  const skeletons = {
    page: <DashboardSkeleton />,
    section: <CardSkeleton />,
    inline: <span className="animate-pulse">Loading...</span>,
  };

  return customSkeleton ?? skeletons[type];
}

/**
 * Helper to wrap async components
 */
export function withLoading<P extends object>(
  Component: React.ComponentType<P>,
  skeleton?: React.ReactNode,
) {
  return function LoadingWrapper(props: P) {
    return (
      <Suspense fallback={skeleton ?? <CardSkeleton />}>
        <Component {...props} />
      </Suspense>
    );
  };
}
