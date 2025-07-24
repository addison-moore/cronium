"use client";

import dynamic from "next/dynamic";
import { WorkflowCanvasSkeleton } from "@cronium/ui";

const WorkflowCanvas = dynamic(() => import("./WorkflowCanvas"), {
  ssr: false,
  loading: () => <WorkflowCanvasSkeleton />,
});

export default WorkflowCanvas;
