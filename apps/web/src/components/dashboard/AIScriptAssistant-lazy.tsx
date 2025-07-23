"use client";

import dynamic from "next/dynamic";
import { FormSkeleton } from "@/components/ui/loading-skeletons";

const AIScriptAssistant = dynamic(() => import("./AIScriptAssistant"), {
  ssr: false,
  loading: () => <FormSkeleton />,
});

export default AIScriptAssistant;
