"use client";

import type { ReactNode } from "react";
import { NextAuthProvider } from "./NextAuthProvider";
import { TrpcProvider } from "./TrpcProvider";
import { ThemeProvider } from "./ThemeProvider";

export function Providers({
  children,
  nonce,
}: {
  children: ReactNode;
  nonce?: string | undefined;
}) {
  return (
    <NextAuthProvider>
      <TrpcProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem={true}
          nonce={nonce}
        >
          {children}
        </ThemeProvider>
      </TrpcProvider>
    </NextAuthProvider>
  );
}
