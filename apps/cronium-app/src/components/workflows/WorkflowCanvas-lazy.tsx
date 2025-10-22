"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@cronium/ui";

const WorkflowCanvas = dynamic(() => import("./WorkflowCanvas"), {
  ssr: false,
  loading: () => <Skeleton className="h-[600px] w-full" />,
});

export default WorkflowCanvas;
