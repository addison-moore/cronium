"use client";

import { loader } from "@monaco-editor/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { Button } from "./button";
import { Skeleton } from "./skeleton";
import { Textarea } from "./textarea";
import type { MonacoEditorProps } from "./monaco-editor";

type MonacoSetup = () => Promise<void>;

let monacoSetup: MonacoSetup | undefined;

// The loader's default is a public CDN. Pointing it at a path that doesn't exist
// makes anything that mounts an editor without a setup fail here, rather than run
// third-party code in the app's origin. A setup's bundled Monaco takes priority.
loader.config({ paths: { vs: "/monaco-editor-not-configured" } });

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

function requireMonacoSetup(): MonacoSetup {
  // Fail loudly rather than let an editor mount with no Monaco behind it.
  if (!monacoSetup) {
    throw new Error(
      "MonacoEditor rendered before setMonacoSetup() was called, so it has no Monaco to load.",
    );
  }
  return monacoSetup;
}

async function downloadEditor(
  setup: MonacoSetup,
): Promise<ComponentType<MonacoEditorProps>> {
  await setup();
  const mod = await import("./monaco-editor");
  return mod.MonacoEditor;
}

/**
 * Stands in when Monaco can't be downloaded, as on a flaky connection or in a tab
 * left open across a deploy. Throwing instead would replace the page with the
 * route's error boundary and lose what the user had typed, and React.lazy caches
 * the failure, so only a full reload would recover. Here the text stays editable,
 * and the real editor takes over as soon as a download succeeds.
 */
function MonacoEditorFallback(props: MonacoEditorProps) {
  const {
    value,
    defaultValue = "",
    onChange,
    height = "400px",
    readOnly = false,
  } = props;
  const [Editor, setEditor] = useState<ComponentType<MonacoEditorProps> | null>(
    null,
  );
  const [draft, setDraft] = useState(defaultValue);
  const [retrying, setRetrying] = useState(true);
  const text = value ?? draft;

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const loaded = await downloadEditor(requireMonacoSetup());
      setEditor(() => loaded);
    } catch (error) {
      console.error("The code editor still could not load:", error);
    } finally {
      setRetrying(false);
    }
  }, []);

  // This component is what React.lazy now remembers for the whole session, so
  // each mount has to try again for the editor to come back without a reload.
  useEffect(() => {
    void retry();
  }, [retry]);

  if (Editor) return <Editor {...props} value={text} />;

  return (
    <div className={`space-y-2 ${props.className ?? ""}`}>
      <div
        role="alert"
        className="border-border bg-muted text-muted-foreground flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
      >
        <span>
          The code editor couldn&apos;t load, so this is a plain text box. Your
          text is kept. If trying again doesn&apos;t help, save your changes and
          reload the page.
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={retrying}
          onClick={() => void retry()}
        >
          {retrying ? "Trying..." : "Try again"}
        </Button>
      </div>
      <Textarea
        aria-label="Code"
        className="font-mono"
        readOnly={readOnly}
        spellCheck={false}
        style={{ height }}
        value={text}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange?.(event.target.value);
        }}
      />
    </div>
  );
}

// Explicitly type the dynamic import to avoid type inference issues
export const MonacoEditor: ComponentType<MonacoEditorProps> = dynamic(
  async () => {
    // Outside the try: a missing setup is a bug to surface, not a bad connection.
    const setup = requireMonacoSetup();
    try {
      return { default: await downloadEditor(setup) };
    } catch (error) {
      console.error("The code editor could not load:", error);
      return { default: MonacoEditorFallback };
    }
  },
  {
    ssr: false,
    loading: () => <Skeleton className="h-[400px] w-full" />,
  },
);

export type { EditorLanguage, MonacoEditorProps } from "./monaco-editor";
