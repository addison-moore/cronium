/**
 * Comprehensive library of reusable skeleton components
 * for consistent loading states across the application
 */

import { Skeleton } from "./skeleton";
import { Card, CardContent, CardHeader } from "./card";
import { cn } from "../lib/utils";

// ============================================
// Card-based Skeletons
// ============================================

export interface CardSkeletonProps {
  showHeader?: boolean;
  showFooter?: boolean;
  className?: string;
}

export function CardSkeleton({
  showHeader = true,
  showFooter = false,
  className,
}: CardSkeletonProps) {
  return (
    <Card className={className}>
      {showHeader && (
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-2 h-4 w-32" />
        </CardHeader>
      )}
      <CardContent className={cn(!showHeader && "pt-6")}>
        <div className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </CardContent>
      {showFooter && (
        <div className="border-border border-t px-6 py-4">
          <Skeleton className="h-4 w-24" />
        </div>
      )}
    </Card>
  );
}

// ============================================
// Form Skeletons
// ============================================

export interface FormFieldSkeletonProps {
  label?: boolean;
  type?: "input" | "textarea" | "select" | "checkbox" | "radio";
}

export function FormFieldSkeleton({
  label = true,
  type = "input",
}: FormFieldSkeletonProps) {
  return (
    <div className="space-y-2">
      {label && <Skeleton className="h-4 w-24" />}
      {type === "input" && <Skeleton className="h-10 w-full" />}
      {type === "textarea" && <Skeleton className="h-24 w-full" />}
      {type === "select" && <Skeleton className="h-10 w-full" />}
      {type === "checkbox" && (
        <div className="flex items-center space-x-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-32" />
        </div>
      )}
      {type === "radio" && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center space-x-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// List Skeletons
// ============================================

export interface ListSkeletonProps {
  items?: number;
  showIcon?: boolean;
  showActions?: boolean;
  className?: string;
}

export function ListSkeleton({
  items = 5,
  showIcon = false,
  showActions = false,
  className,
}: ListSkeletonProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          className="border-border flex items-center justify-between rounded-lg border p-4"
        >
          <div className="flex items-center space-x-3">
            {showIcon && <Skeleton className="h-8 w-8 rounded" />}
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          {showActions && (
            <div className="flex items-center space-x-2">
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================
// Grid Skeletons
// ============================================

export interface GridSkeletonProps {
  items?: number;
  columns?: number;
  className?: string;
}

export function GridSkeleton({
  items = 6,
  columns = 3,
  className,
}: GridSkeletonProps) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 2 && "grid-cols-1 md:grid-cols-2",
        columns === 3 && "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {Array.from({ length: items }).map((_, i) => (
        <CardSkeleton key={i} showHeader={true} />
      ))}
    </div>
  );
}

// ============================================
// Page Layout Skeletons
// ============================================

export interface PageHeaderSkeletonProps {
  showActions?: boolean;
  showBreadcrumb?: boolean;
}

export function PageHeaderSkeleton({
  showActions = true,
  showBreadcrumb = false,
}: PageHeaderSkeletonProps) {
  return (
    <div className="space-y-4">
      {showBreadcrumb && (
        <div className="flex items-center space-x-2">
          <Skeleton className="h-4 w-16" />
          <span className="text-muted-foreground">/</span>
          <Skeleton className="h-4 w-24" />
          <span className="text-muted-foreground">/</span>
          <Skeleton className="h-4 w-32" />
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="mb-2 h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        {showActions && (
          <div className="flex items-center space-x-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-10" />
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Dialog/Modal Skeletons
// ============================================

export function DialogSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="space-y-4 py-4">
        <FormFieldSkeleton />
        <FormFieldSkeleton type="textarea" />
        <FormFieldSkeleton type="select" />
      </div>
      <div className="flex justify-end space-x-2">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  );
}

// ============================================
// Badge/Tag Skeletons
// ============================================

export interface BadgeSkeletonProps {
  count?: number;
  size?: "sm" | "md" | "lg";
}

export function BadgeGroupSkeleton({
  count = 3,
  size = "md",
}: BadgeSkeletonProps) {
  const sizes = {
    sm: "h-5 w-16",
    md: "h-6 w-20",
    lg: "h-8 w-24",
  };

  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn("rounded-full", sizes[size])} />
      ))}
    </div>
  );
}

// ============================================
// Progress/Status Skeletons
// ============================================

export function ProgressSkeleton() {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className="h-2 w-full" />
    </div>
  );
}

// ============================================
// Empty State Skeleton
// ============================================

export function EmptyStateSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center space-y-4 py-12">
      <Skeleton className="h-16 w-16 rounded-full" />
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="mt-4 h-10 w-32" />
    </div>
  );
}

// ============================================
// Sidebar/Navigation Skeletons
// ============================================

export function SidebarSkeleton() {
  return (
    <div className="border-border bg-background h-full w-64 space-y-4 border-r p-4">
      <Skeleton className="mb-6 h-8 w-32" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center space-x-3 p-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Tabs Skeleton
// ============================================

export interface TabsSkeletonProps {
  tabCount?: number;
  showContent?: boolean;
}

export function TabsSkeleton({
  tabCount = 3,
  showContent = true,
}: TabsSkeletonProps) {
  return (
    <div className="space-y-4">
      <div className="border-border flex space-x-4 border-b">
        {Array.from({ length: tabCount }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-24" />
        ))}
      </div>
      {showContent && (
        <div className="py-4">
          <Skeleton className="h-96 w-full" />
        </div>
      )}
    </div>
  );
}

// ============================================
// Notification/Alert Skeleton
// ============================================

export function NotificationSkeleton() {
  return (
    <div className="border-border flex items-start space-x-3 rounded-lg border p-4">
      <Skeleton className="mt-0.5 h-5 w-5" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

// ============================================
// Composite Skeletons for Common Patterns
// ============================================

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="mb-2 h-8 w-20" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <CardSkeleton className="col-span-full" />
    </div>
  );
}

export function DetailPageSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton showBreadcrumb />
      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="space-y-6">
          <CardSkeleton />
          <CardSkeleton showFooter />
        </div>
      </div>
    </div>
  );
}
