"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { supportedLocales, type SupportedLocale } from "@shared/i18n";

// Create a context to manage the current locale
type LanguageContextType = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string) => string;
};

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

export function LanguageProvider({
  children,
  initialLocale = "en",
}: {
  children: ReactNode;
  initialLocale?: string;
}) {
  // Default to English or the initialLocale passed from props
  const [locale, setLocale] = useState<SupportedLocale>(
    initialLocale as SupportedLocale,
  );

  // Detect initial locale from URL or browser setting
  useEffect(() => {
    const detectLocale = () => {
      // Try to detect from URL first
      const path = window.location.pathname;
      for (const loc of supportedLocales) {
        if (path.startsWith(`/${loc}/`) || path === `/${loc}`) {
          return loc;
        }
      }

      // Fallback to browser language
      const browserLang = navigator.language.split("-")[0];
      return supportedLocales.includes(browserLang as SupportedLocale)
        ? (browserLang as SupportedLocale)
        : "en";
    };

    setLocale(detectLocale());
  }, []);

  // Simple translation function with default fallback behavior
  const t = (key: string): string => {
    // This is just a fallback in case the context isn't available
    // The real translations come from next-intl context in useLanguage hook
    return key;
  };

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// Hook to use the language context
export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }

  // Try to use next-intl's useTranslations if available
  let t = context.t;
  try {
    const translate = useTranslations();
    t = (key: string): string => {
      try {
        return translate(key);
      } catch (error) {
        return key; // Fallback to key if translation not found
      }
    };
  } catch (error) {
    // Fallback to using the key as the translation
    console.warn("Failed to use next-intl translations, using fallback", error);
  }

  return { ...context, t };
}
