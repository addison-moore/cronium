"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { type ReactNode } from "react";

type Attribute = "class" | "data-theme" | "data-mode";

interface ThemeProviderProps {
  children: ReactNode;
  attribute?: Attribute | Attribute[];
  defaultTheme?: string;
  enableSystem?: boolean;
  enableColorScheme?: boolean;
  disableTransitionOnChange?: boolean;
  storageKey?: string;
  themes?: string[];
  forcedTheme?: string;
  value?: Record<string, string>;
  // Allows next-themes' inline script under the production CSP.
  nonce?: string | undefined;
}

export function ThemeProvider({
  children,
  nonce,
  ...props
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      {...props}
      {...(nonce ? { nonce } : {})}
      attribute="class"
      enableSystem={true}
      enableColorScheme={true}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
