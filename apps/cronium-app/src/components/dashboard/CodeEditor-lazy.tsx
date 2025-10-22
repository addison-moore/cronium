"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@cronium/ui";

const CodeEditor = dynamic(() => import("./CodeEditor"), {
  ssr: false,
  loading: () => <Skeleton className="h-[400px] w-full" />,
});

export default CodeEditor;
