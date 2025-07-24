"use client";

import dynamic from "next/dynamic";
import { CodeEditorSkeleton } from "@cronium/ui";

const CodeEditor = dynamic(() => import("./CodeEditor"), {
  ssr: false,
  loading: () => <CodeEditorSkeleton />,
});

export default CodeEditor;
