"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { Skeleton } from "./skeleton";
import type { MonacoEditorProps } from "./monaco-editor";

// Explicitly type the dynamic import to avoid type inference issues
export const MonacoEditor: ComponentType<MonacoEditorProps> = dynamic(
  () =>
    import("./monaco-editor").then((mod) => ({ default: mod.MonacoEditor })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[400px] w-full" />,
  },
) as ComponentType<MonacoEditorProps>;

export type { EditorLanguage, MonacoEditorProps } from "./monaco-editor";
