"use client";

import type { ReactNode } from "react";
import { setMonacoSetup } from "@cronium/ui";
import { NextAuthProvider } from "./NextAuthProvider";
import { TrpcProvider } from "./TrpcProvider";
import { ThemeProvider } from "./ThemeProvider";

// Every editor renders inside these providers, so this runs before any of them
// mounts. Monaco is browser-only: the `window` check also keeps it out of the
// server bundle, where the compiler drops this branch.
if (typeof window !== "undefined") {
  setMonacoSetup(async () => {
    const { setupMonaco } = await import("@/lib/monaco-setup");
    setupMonaco();
  });
}

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
