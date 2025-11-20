"use client";

import type { ReactNode } from "react";
import { NextAuthProvider } from "./NextAuthProvider";
import { TrpcProvider } from "./TrpcProvider";
import { ThemeProvider } from "./ThemeProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NextAuthProvider>
      <TrpcProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem={true}
        >
          {children}
        </ThemeProvider>
      </TrpcProvider>
    </NextAuthProvider>
  );
}
