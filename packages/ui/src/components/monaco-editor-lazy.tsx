"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { Skeleton } from "./skeleton";
import type { MonacoEditorProps } from "./monaco-editor";

type MonacoSetup = () => Promise<void>;

let monacoSetup: MonacoSetup | undefined;

/**
 * Registers how the host app provides Monaco to `MonacoEditor`. The setup must
 * configure `@monaco-editor/react`'s loader with a bundled copy of Monaco.
 *
 * Without that the loader falls back to running Monaco from a public CDN, so
 * this package can't simply be left unconfigured. It also can't import Monaco
 * itself: everything here is bundled into one file that every consumer loads,
 * including apps that never render an editor.
 *
 * Register from a module that loads before any editor renders, and keep the
 * Monaco import behind a dynamic `import()` so only editor pages download it.
 */
export function setMonacoSetup(setup: MonacoSetup): void {
  monacoSetup = setup;
}

// Explicitly type the dynamic import to avoid type inference issues
export const MonacoEditor: ComponentType<MonacoEditorProps> = dynamic(
  async () => {
    // Fail loudly rather than let the loader quietly reach for the CDN.
    if (!monacoSetup) {
      throw new Error(
        "MonacoEditor rendered before setMonacoSetup() was called, so Monaco would load from a public CDN.",
      );
    }
    await monacoSetup();
    const mod = await import("./monaco-editor");
    return { default: mod.MonacoEditor };
  },
  {
    ssr: false,
    loading: () => <Skeleton className="h-[400px] w-full" />,
  },
);

export type { EditorLanguage, MonacoEditorProps } from "./monaco-editor";
