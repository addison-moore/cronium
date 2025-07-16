import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export function LogDetailsSkeleton() {
  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center">
        <Button variant="ghost" size="sm" className="mr-2" disabled>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Logs
        </Button>
        <Skeleton className="h-8 w-48" />
        <div className="ml-4">
          <Skeleton className="h-6 w-20" />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Execution Output Card */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center">
              <Skeleton className="mr-2 h-5 w-5" />
              <Skeleton className="h-6 w-40" />
            </div>
            <Skeleton className="mt-2 h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="h-[400px] rounded-md bg-slate-950 p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-full bg-slate-800" />
                <Skeleton className="h-4 w-3/4 bg-slate-800" />
                <Skeleton className="h-4 w-5/6 bg-slate-800" />
                <Skeleton className="h-4 w-2/3 bg-slate-800" />
                <Skeleton className="h-4 w-full bg-slate-800" />
                <Skeleton className="h-4 w-4/5 bg-slate-800" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Details Card */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-20" />
            <Skeleton className="mt-2 h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="mb-2 h-4 w-24" />
                <Skeleton className="h-5 w-full max-w-[150px]" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Script Content Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center">
            <Skeleton className="mr-2 h-5 w-5" />
            <Skeleton className="h-6 w-32" />
          </div>
          <Skeleton className="mt-2 h-4 w-80" />
        </CardHeader>
        <CardContent>
          <div className="h-[400px] rounded-md bg-slate-950 p-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-full bg-slate-800" />
              <Skeleton className="h-4 w-5/6 bg-slate-800" />
              <Skeleton className="h-4 w-3/4 bg-slate-800" />
              <Skeleton className="h-4 w-full bg-slate-800" />
              <Skeleton className="h-4 w-2/3 bg-slate-800" />
              <Skeleton className="h-4 w-4/5 bg-slate-800" />
              <Skeleton className="h-4 w-full bg-slate-800" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
