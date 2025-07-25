"use client";

import { useEffect } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Function to update theme based on system preference
    const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };

    // Check initial preference
    const darkModeMediaQuery = window.matchMedia(
      "(prefers-color-scheme: dark)",
    );
    updateTheme(darkModeMediaQuery);

    // Listen for changes
    darkModeMediaQuery.addEventListener("change", updateTheme);

    // Cleanup
    return () => {
      darkModeMediaQuery.removeEventListener("change", updateTheme);
    };
  }, []);

  return <>{children}</>;
}
