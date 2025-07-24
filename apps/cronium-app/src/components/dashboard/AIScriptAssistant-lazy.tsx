"use client";

import dynamic from "next/dynamic";
import { FormSkeleton } from "@cronium/ui";

const AIScriptAssistant = dynamic(() => import("./AIScriptAssistant"), {
  ssr: false,
  loading: () => <FormSkeleton />,
});

export default AIScriptAssistant;
