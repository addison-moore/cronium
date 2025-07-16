"use client";

import dynamic from "next/dynamic";
import { WorkflowCanvasSkeleton } from "@/components/ui/loading-skeletons";

const WorkflowCanvas = dynamic(() => import("./WorkflowCanvas"), {
  ssr: false,
  loading: () => <WorkflowCanvasSkeleton />,
});

export default WorkflowCanvas;
