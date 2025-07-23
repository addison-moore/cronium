"use client";

import dynamic from "next/dynamic";
import { CodeEditorSkeleton } from "@/components/ui/loading-skeletons";

const CodeEditor = dynamic(() => import("./CodeEditor"), {
  ssr: false,
  loading: () => <CodeEditorSkeleton />,
});

export default CodeEditor;
