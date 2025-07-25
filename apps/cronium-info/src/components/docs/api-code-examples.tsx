"use client";

import React, { useState, useEffect, createContext, useContext } from "react";
import { Button } from "@cronium/ui";
import { Copy } from "lucide-react";
import Prism from "prismjs";
// Import Prism theme for syntax highlighting
import "prismjs/themes/prism-tomorrow.css";
// Import language components directly
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";

type Language = "python" | "nodejs" | "curl";

interface CodeExample {
  python: string;
  nodejs: string;
  curl: string;
}

interface LanguageContextType {
  selectedLanguage: Language;
  setSelectedLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType>({
  selectedLanguage: "python",
  setSelectedLanguage: () => {
    // Default empty implementation for context
  },
});

function getSyntaxLanguage(language: Language): string {
  switch (language) {
    case "python":
      return "python";
    case "nodejs":
      return "javascript";
    case "curl":
      return "bash";
    default:
      return "bash";
  }
}

export function CodeBlock({
  examples,
  title,
}: {
  examples: CodeExample;
  title?: string;
}) {
  const { selectedLanguage, setSelectedLanguage } = useContext(LanguageContext);
  const [mounted, setMounted] = useState(false);

  const languages: { key: Language; label: string }[] = [
    { key: "python", label: "Python" },
    { key: "nodejs", label: "Node.js" },
    { key: "curl", label: "cURL" },
  ];

  const code = examples[selectedLanguage];
  const syntaxLanguage = getSyntaxLanguage(selectedLanguage);

  useEffect(() => {
    setMounted(true);
  }, []);

  const getHighlightedCode = () => {
    if (!mounted || typeof window === "undefined") {
      return code;
    }

    if (Prism.languages[syntaxLanguage]) {
      return Prism.highlight(
        code,
        Prism.languages[syntaxLanguage],
        syntaxLanguage,
      );
    }
    return code;
  };

  const copyToClipboard = () => {
    void navigator.clipboard.writeText(code);
  };

  const highlightedCode = getHighlightedCode();

  return (
    <div className="mb-4">
      {title && <h4 className="mb-3 font-semibold">{title}</h4>}

      {/* Language Switcher */}
      <div className="bg-muted mb-3 flex w-fit items-center gap-1 rounded-lg p-1">
        {languages.map((lang) => (
          <Button
            key={lang.key}
            variant={selectedLanguage === lang.key ? "default" : "ghost"}
            size="sm"
            onClick={() => setSelectedLanguage(lang.key)}
            className="px-3 py-1 text-xs"
          >
            {lang.label}
          </Button>
        ))}
      </div>

      {/* Code Block */}
      <div className="relative">
        <pre
          className="border-border overflow-x-auto rounded-lg border bg-stone-900 p-4 text-sm text-gray-100"
          suppressHydrationWarning
        >
          {mounted && highlightedCode !== code ? (
            <code
              className={`language-${syntaxLanguage}`}
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
              suppressHydrationWarning
            />
          ) : (
            <code className={`language-${syntaxLanguage}`}>{code}</code>
          )}
        </pre>
        <button
          onClick={copyToClipboard}
          className="absolute top-2 right-2 p-2 text-gray-400 transition-colors hover:text-gray-200"
          title="Copy to clipboard"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function SimpleCodeBlock({
  children,
  language = "bash",
  className,
}: {
  children: string;
  language?: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const getHighlightedCode = () => {
    if (!mounted || typeof window === "undefined") {
      return children;
    }

    if (Prism.languages[language]) {
      return Prism.highlight(children, Prism.languages[language], language);
    }
    return children;
  };

  const copyToClipboard = () => {
    void navigator.clipboard.writeText(children);
  };

  const highlightedCode = getHighlightedCode();

  return (
    <div className="relative">
      <pre
        className={`bg-grey-800 overflow-x-auto rounded-lg p-4 text-sm text-gray-100 ${className ?? ""}`}
        suppressHydrationWarning
      >
        {mounted && highlightedCode !== children ? (
          <code
            className={`language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
            suppressHydrationWarning
          />
        ) : (
          <code className={`language-${language}`}>{children}</code>
        )}
      </pre>
      <button
        onClick={copyToClipboard}
        className="absolute top-2 right-2 p-2 text-gray-400 transition-colors hover:text-gray-200"
        title="Copy to clipboard"
      >
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function ApiCodeExamples({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedLanguage, setSelectedLanguage] = useState<Language>("python");

  return (
    <LanguageContext.Provider value={{ selectedLanguage, setSelectedLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}
