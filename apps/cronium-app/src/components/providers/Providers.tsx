"use client";

import type { ReactNode } from "react";
import { setMonacoSetup } from "@cronium/ui";
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
  // NextAuthProvider isn't here, on purpose. It's in the dashboard's layout, the only place that
  // reads the session. When the session arrives, React counts that as a change to everything
  // under the provider, and throws away any server HTML it couldn't hydrate yet because the
  // page's own chunk is still loading. On a slow connection those two arrive within milliseconds
  // of each other, and when the session won, the sign-in form came back empty, with what was
  // typed and any press made before hydration gone.
  return (
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
  );
}
