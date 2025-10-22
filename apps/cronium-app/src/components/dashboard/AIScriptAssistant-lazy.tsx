"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@cronium/ui";

const AIScriptAssistant = dynamic(() => import("./AIScriptAssistant"), {
  ssr: false,
  loading: () => <Skeleton className="h-[600px] w-full" />,
});

export default AIScriptAssistant;
