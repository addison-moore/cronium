"use client";

import React, { useState, useEffect, createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";

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
  setSelectedLanguage: () => {},
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
  const [highlightedCode, setHighlightedCode] = useState<string>("");

  const languages: { key: Language; label: string }[] = [
    { key: "python", label: "Python" },
    { key: "nodejs", label: "Node.js" },
    { key: "curl", label: "cURL" },
  ];

  const code = examples[selectedLanguage];

  useEffect(() => {
    // Dynamic import of Prism.js for client-side only
    const loadPrism = async () => {
      const Prism = (await import("prismjs")).default;
      await import("prismjs/themes/prism-tomorrow.css");
      await import("prismjs/components/prism-python");
      await import("prismjs/components/prism-javascript");
      await import("prismjs/components/prism-bash");

      const syntaxLanguage = getSyntaxLanguage(selectedLanguage);
      if (Prism.languages[syntaxLanguage]) {
        const highlighted = Prism.highlight(
          code,
          Prism.languages[syntaxLanguage],
          syntaxLanguage,
        );
        setHighlightedCode(highlighted);
      } else {
        setHighlightedCode(code);
      }
    };

    loadPrism().catch(() => {
      // Fallback to plain text if Prism fails to load
      setHighlightedCode(code);
    });
  }, [code, selectedLanguage]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
  };

  return (
    <div className="mb-4">
      {title && <h4 className="font-semibold mb-3">{title}</h4>}

      {/* Language Switcher */}
      <div className="flex items-center gap-1 mb-3 p-1 bg-muted rounded-lg w-fit">
        {languages.map((lang) => (
          <Button
            key={lang.key}
            variant={selectedLanguage === lang.key ? "default" : "ghost"}
            size="sm"
            onClick={() => setSelectedLanguage(lang.key)}
            className="text-xs px-3 py-1"
          >
            {lang.label}
          </Button>
        ))}
      </div>

      {/* Code Block */}
      <div className="relative">
        <pre className="bg-stone-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm border border-border">
          <code
            className={`language-${getSyntaxLanguage(selectedLanguage)}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </pre>
        <button
          onClick={copyToClipboard}
          className="absolute top-2 right-2 p-2 text-gray-400 hover:text-gray-200 transition-colors"
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
  const [highlightedCode, setHighlightedCode] = useState<string>("");

  useEffect(() => {
    const loadPrism = async () => {
      try {
        const Prism = (await import("prismjs")).default;
        await import("prismjs/themes/prism-tomorrow.css");
        await import("prismjs/components/prism-json");
        await import("prismjs/components/prism-bash");

        if (Prism.languages[language]) {
          const highlighted = Prism.highlight(
            children,
            Prism.languages[language],
            language,
          );
          setHighlightedCode(highlighted);
        } else {
          setHighlightedCode(children);
        }
      } catch {
        setHighlightedCode(children);
      }
    };

    loadPrism();
  }, [children, language]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(children);
  };

  return (
    <div className="relative">
      <pre className={`bg-grey-800 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm ${className || ''}`}>
        <code
          className={`language-${language}`}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>
      <button
        onClick={copyToClipboard}
        className="absolute top-2 right-2 p-2 text-gray-400 hover:text-gray-200 transition-colors"
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
