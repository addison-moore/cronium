"use client";

import type { ReactNode } from "react";
import { NextAuthProvider } from "./NextAuthProvider";
import { TrpcProvider } from "./TrpcProvider";
import { ServiceInitializer } from "./ServiceInitializer";
import { ThemeProvider } from "./ThemeProvider";
import { LanguageProvider } from "./language-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NextAuthProvider>
      <TrpcProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem={true}
        >
          <LanguageProvider>
            <ServiceInitializer />
            {children}
          </LanguageProvider>
        </ThemeProvider>
      </TrpcProvider>
    </NextAuthProvider>
  );
}
