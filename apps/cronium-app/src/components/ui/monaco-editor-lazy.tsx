"use client";

import dynamic from "next/dynamic";
import { CodeEditorSkeleton } from "@cronium/ui";

export const MonacoEditor = dynamic(
  () =>
    import("./monaco-editor").then((mod) => ({ default: mod.MonacoEditor })),
  {
    ssr: false,
    loading: () => <CodeEditorSkeleton />,
  },
);

export type { EditorLanguage } from "./monaco-editor";
