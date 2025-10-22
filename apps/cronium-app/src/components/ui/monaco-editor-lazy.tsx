"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@cronium/ui";

export const MonacoEditor = dynamic(
  () =>
    import("./monaco-editor").then((mod) => ({ default: mod.MonacoEditor })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[400px] w-full" />,
  },
);

export type { EditorLanguage } from "./monaco-editor";
