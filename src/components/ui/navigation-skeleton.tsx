import { Skeleton } from "@/components/ui/skeleton";

export function NavigationSkeleton() {
  return (
    <div className="bg-background fixed inset-y-0 left-0 hidden w-64 flex-col border-r md:flex">
      <div className="flex h-full flex-col">
        {/* Logo section */}
        <div className="flex items-center justify-between border-b p-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>

        {/* Navigation items */}
        <div className="flex-grow">
          <nav className="flex-1 overflow-y-auto px-3 py-6">
            <ul className="space-y-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <li key={i}>
                  <div className="flex items-center rounded-md px-3 py-2">
                    <Skeleton className="mr-3 h-5 w-5" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Theme toggle section */}
        <div className="border-t p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>

        {/* User section */}
        <div className="border-t p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1">
              <Skeleton className="mb-1 h-3 w-20" />
              <Skeleton className="h-2 w-16" />
            </div>
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileNavigationSkeleton() {
  return (
    <div className="bg-background fixed top-0 right-0 left-0 z-30 flex h-16 items-center justify-between border-b px-4 shadow-sm md:hidden">
      <Skeleton className="h-8 w-28" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
    </div>
  );
}
