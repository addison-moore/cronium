"use client";

import React, { useState, useEffect, type MouseEventHandler } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import { Button } from "./button";
import { Badge } from "./badge";
import { Maximize2, Minimize2, X } from "lucide-react";

interface EditorSettings {
  fontSize: number;
  theme: string;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
}

export type EditorLanguage =
  | "javascript"
  | "typescript"
  | "python"
  | "bash"
  | "json"
  | "yaml"
  | "sql"
  | "dockerfile"
  | "markdown"
  | "html"
  | "text";

type EditorTheme = "vs-dark" | "vs-light" | "hc-black";

export interface MonacoEditorProps {
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  language?: EditorLanguage;
  height?: string;
  readOnly?: boolean;
  className?: string;
  editorSettings?: Partial<EditorSettings>;
}

export function MonacoEditor({
  defaultValue = "",
  value,
  onChange,
  language = "javascript" as EditorLanguage,
  height = "400px",
  readOnly = false,
  className = "",
  editorSettings,
}: MonacoEditorProps) {
  const [mounted, setMounted] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle expanded state
  const toggleExpanded: MouseEventHandler<HTMLButtonElement> = () => {
    setIsExpanded(!isExpanded);
  };

  // Handle escape key to close expanded view
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isExpanded) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isExpanded]);

  const handleEditorWillMount = (monacoInstance: Monaco) => {
    // Configure TypeScript/JavaScript compiler options for better linting
    monacoInstance.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monacoInstance.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution:
        monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monacoInstance.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      allowJs: true,
      allowSyntheticDefaultImports: true,
    });

    monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monacoInstance.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution:
        monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monacoInstance.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      allowJs: true,
      allowSyntheticDefaultImports: true,
      strict: false, // Less strict for script editing
    });

    // Configure diagnostics options
    monacoInstance.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
      {
        noSemanticValidation: false,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: false,
      },
    );

    monacoInstance.languages.typescript.typescriptDefaults.setDiagnosticsOptions(
      {
        noSemanticValidation: false,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: false,
      },
    );

    // Add common Node.js and browser globals for better intellisense
    const globalLibSource = [
      "declare const console: Console;",
      "declare const process: NodeJS.Process;",
      "declare const Buffer: BufferConstructor;",
      "declare const __dirname: string;",
      "declare const __filename: string;",
      "declare const require: NodeRequire;",
      "declare const module: NodeModule;",
      "declare const exports: NodeModule['exports'];",
      "declare const global: typeof globalThis;",
      "declare const setTimeout: typeof globalThis.setTimeout;",
      "declare const setInterval: typeof globalThis.setInterval;",
      "declare const clearTimeout: typeof globalThis.clearTimeout;",
      "declare const clearInterval: typeof globalThis.clearInterval;",
      "declare const fetch: typeof globalThis.fetch;",
    ].join("\n");

    // Add Cronium-specific runtime helper functions
    const croniumLibSource = [
      "/**",
      " * Cronium Runtime Helper Functions",
      " * These functions are available in all script executions",
      " */",
      "interface CroniumEventContext {",
      "  name: string;",
      "  type: string;",
      "  id: number;",
      "  executionId: string;",
      "}",
      "",
      "interface CroniumAPI {",
      "  /**",
      "   * Get input data passed to this script from previous workflow nodes",
      "   * @returns The input data object or undefined if no input",
      "   */",
      "  input(): unknown;",
      "",
      "  /**",
      "   * Set output data to be passed to subsequent workflow nodes",
      "   * @param data - The data to output",
      "   */",
      "  output(data: unknown): void;",
      "",
      "  /**",
      "   * Get the current event context information",
      "   * @returns Event metadata including name, type, and execution details",
      "   */",
      "  event(): CroniumEventContext;",
      "",
      "  /**",
      "   * Set a condition flag for conditional event triggers",
      "   * @param condition - Boolean condition to set",
      "   */",
      "  setCondition(condition: boolean): void;",
      "",
      "  /**",
      "   * Get the current condition flag value",
      "   * @returns The current condition state",
      "   */",
      "  getCondition(): boolean;",
      "",
      "  /**",
      "   * Get a user variable by key",
      "   * @param key - The variable key",
      "   * @returns The variable value or undefined if not found",
      "   */",
      "  getVariable(key: string): string | undefined;",
      "",
      "  /**",
      "   * Set a user variable that persists across script executions",
      "   * @param key - The variable key",
      "   * @param value - The variable value",
      "   */",
      "  setVariable(key: string, value: string): void;",
      "}",
      "",
      "// Make cronium available globally",
      "declare const cronium: CroniumAPI;",
    ].join("\n");

    monacoInstance.languages.typescript.javascriptDefaults.addExtraLib(
      globalLibSource,
      "ts:globals.d.ts",
    );

    monacoInstance.languages.typescript.javascriptDefaults.addExtraLib(
      croniumLibSource,
      "ts:cronium.d.ts",
    );
  };

  if (!mounted) {
    // Return a placeholder with the same height to prevent layout shift
    return (
      <div
        style={{ height }}
        className={`border-border bg-muted flex w-full items-center justify-center rounded-md border ${className}`}
      >
        <div className="text-muted-foreground">Loading editor...</div>
      </div>
    );
  }

  const defaultSettings: EditorSettings = {
    fontSize: 14,
    theme: "vs-dark" as EditorTheme,
    wordWrap: true,
    minimap: false,
    lineNumbers: true,
  };

  const settings: EditorSettings = { ...defaultSettings, ...editorSettings };

  const EditorComponent = (
    <Editor
      defaultValue={defaultValue}
      value={value ?? ""}
      height={isExpanded ? "100vh" : height}
      language={language}
      theme={settings.theme}
      beforeMount={handleEditorWillMount}
      options={{
        readOnly,
        fontSize: settings.fontSize,
        minimap: { enabled: settings.minimap },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        lineNumbers: settings.lineNumbers ? "on" : "off",
        folding: true,
        wordWrap: settings.wordWrap ? "on" : "off",
        // Enhanced linting and error detection
        quickSuggestions: {
          other: true,
          comments: true,
          strings: true,
        },
        acceptSuggestionOnCommitCharacter: true,
        acceptSuggestionOnEnter: "on",
        accessibilitySupport: "auto",
        autoIndent: "full",
        contextmenu: true,
        formatOnPaste: true,
        formatOnType: true,
        hover: {
          enabled: true,
        },
        links: true,
        mouseWheelZoom: true,
        multiCursorMergeOverlapping: true,
        parameterHints: {
          enabled: true,
        },
        quickSuggestionsDelay: 10,
        suggestOnTriggerCharacters: true,
        tabCompletion: "on",
        wordBasedSuggestions: "matchingDocuments",
        // Error and warning indicators
        glyphMargin: true,
        renderWhitespace: "selection",
        showFoldingControls: "mouseover",
      }}
      onChange={(value) => {
        if (onChange && value !== undefined) {
          onChange(value);
        }
      }}
    />
  );

  if (isExpanded) {
    return (
      <div className="bg-background fixed inset-0 z-50">
        {/* Header with controls */}
        <div className="border-border bg-background flex items-center justify-between border-b p-4">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">Code Editor</h3>
            <Badge variant="secondary">{language.toUpperCase()}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleExpanded}
              className="flex items-center gap-1"
            >
              <Minimize2 size={16} />
              Minimize
            </Button>
            <Button variant="outline" size="sm" onClick={toggleExpanded}>
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Editor content */}
        <div className="h-[calc(100vh-73px)]">{EditorComponent}</div>
      </div>
    );
  }

  return (
    <div
      className={`monaco-editor-container ${className} group relative overflow-hidden rounded-md`}
    >
      {/* Expand button */}
      <Button
        variant="outline"
        size="sm"
        onClick={toggleExpanded}
        className="absolute right-2 bottom-2 z-10 p-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        title="Expand editor"
      >
        <Maximize2 size={16} />
      </Button>

      {EditorComponent}
    </div>
  );
}
