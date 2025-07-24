import { Card } from "@cronium/ui";
import { Skeleton } from "@cronium/ui";

export default function AuthLoading() {
  return (
    <div className="relative container grid min-h-screen flex-col items-center justify-center lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="border-border bg-muted relative hidden h-full flex-col p-10 text-white lg:flex dark:border-r">
        <div className="absolute inset-0 bg-zinc-900" />
        <div className="relative z-20 flex items-center text-lg font-medium">
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="relative z-20 mt-auto">
          <Skeleton className="mb-2 h-6 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="lg:p-8">
        <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
          <Card className="p-6">
            <div className="mb-6 flex flex-col space-y-2 text-center">
              <Skeleton className="mx-auto h-8 w-48" />
              <Skeleton className="mx-auto h-4 w-64" />
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
              <Skeleton className="h-10 w-full" />
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
