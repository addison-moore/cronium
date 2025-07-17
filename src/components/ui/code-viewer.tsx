"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CodeViewerProps {
  code: string;
  language: string;
  height?: string;
  className?: string;
  showLineNumbers?: boolean;
  theme?: "dark" | "light";
}

// Map common language names to Prism language identifiers
const languageMap: Record<string, string> = {
  javascript: "javascript",
  typescript: "typescript",
  python: "python",
  bash: "bash",
  shell: "bash",
  json: "json",
  html: "html",
  css: "css",
  jsx: "jsx",
  tsx: "tsx",
  sql: "sql",
  yaml: "yaml",
  xml: "xml",
  markdown: "markdown",
  // Add more mappings as needed
};

export default function CodeViewer({
  code,
  language,
  height = "auto",
  className,
  showLineNumbers = true,
  theme = "dark",
}: CodeViewerProps) {
  const [highlightedCode, setHighlightedCode] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const prismLanguage = languageMap[language.toLowerCase()] ?? language;

  useEffect(() => {
    const loadPrism = async () => {
      setIsLoading(true);
      try {
        const Prism = (await import("prismjs")).default;

        // Import theme based on prop - removed as it causes TypeScript errors
        // CSS imports are handled separately in the build process
        // if (theme === "dark") {
        //   await import("prismjs/themes/prism-tomorrow.css");
        // } else {
        //   await import("prismjs/themes/prism.css");
        // }

        // Try to load the specific language component
        try {
          await import(`prismjs/components/prism-${prismLanguage}`);
        } catch (error) {
          console.error(
            `Failed to load Prism language component for ${prismLanguage}:`,
            error,
          );
          // Language component might not exist or already be loaded
        }

        // Add line numbers plugin
        if (showLineNumbers) {
          await import(
            "prismjs/plugins/line-numbers/prism-line-numbers" as any
          );
          // CSS import removed as it causes TypeScript errors
          // await import("prismjs/plugins/line-numbers/prism-line-numbers.css");
        }

        if (Prism.languages[prismLanguage]) {
          const highlighted = Prism.highlight(
            code,
            Prism.languages[prismLanguage],
            prismLanguage,
          );
          setHighlightedCode(highlighted);
        } else {
          // Fallback to plain text if language not supported
          setHighlightedCode(code);
        }
      } catch (error) {
        console.error("Error loading Prism:", error);
        setHighlightedCode(code);
      } finally {
        setIsLoading(false);
      }
    };

    void loadPrism();
  }, [code, prismLanguage, showLineNumbers, theme]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  if (isLoading) {
    return (
      <div
        className={cn("bg-muted/50 relative rounded-lg border p-4", className)}
        style={{ height }}
      >
        <div className="animate-pulse">
          <div className="bg-muted-foreground/20 mb-2 h-4 w-3/4 rounded" />
          <div className="bg-muted-foreground/20 mb-2 h-4 w-full rounded" />
          <div className="bg-muted-foreground/20 h-4 w-5/6 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group relative", className)}>
      <div
        className={cn(
          "overflow-auto rounded-lg border",
          theme === "dark" ? "bg-stone-900" : "bg-gray-50",
        )}
        style={{ height, maxHeight: height }}
      >
        <pre className={cn("!m-0 text-sm", showLineNumbers && "line-numbers")}>
          <code
            className={`language-${prismLanguage}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </pre>
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={handleCopy}
        className={cn(
          "absolute top-2 right-2 h-8 w-8 p-0",
          "opacity-0 transition-opacity group-hover:opacity-100",
        )}
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

// Lazy-loaded version for dynamic imports
export const CodeViewerLazy = React.lazy(
  () => import("@/components/ui/code-viewer"),
);
