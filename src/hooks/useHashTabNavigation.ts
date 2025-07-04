"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";

interface UseHashTabNavigationOptions {
  defaultTab: string;
  validTabs: string[];
  onTabChange?: (tab: string) => void;
}

/**
 * Hook for managing tab navigation with URL hash support
 * Allows direct navigation to specific tabs using URL fragments like #edit, #system, etc.
 */
export function useHashTabNavigation({
  defaultTab,
  validTabs,
  onTabChange,
}: UseHashTabNavigationOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Get tab from URL hash on mount and when hash changes
  const getTabFromHash = useCallback(() => {
    if (typeof window === "undefined") return defaultTab;

    const hash = window.location.hash.substring(1); // Remove the # symbol
    return validTabs.includes(hash) ? hash : defaultTab;
  }, [defaultTab, validTabs]);

  // Update tab when hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const newTab = getTabFromHash();
      setActiveTab(newTab);
      onTabChange?.(newTab);
    };

    // Set initial tab from hash
    handleHashChange();

    // Listen for hash changes
    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [getTabFromHash, onTabChange]);

  // Function to change tab and update URL hash
  const changeTab = useCallback(
    (newTab: string) => {
      if (!validTabs.includes(newTab)) {
        console.warn(
          `Invalid tab: ${newTab}. Valid tabs are: ${validTabs.join(", ")}`,
        );
        return;
      }

      setActiveTab(newTab);
      onTabChange?.(newTab);

      // Update URL hash without triggering a page reload
      const newUrl = `${pathname}#${newTab}`;
      window.history.replaceState(null, "", newUrl);
    },
    [validTabs, onTabChange, pathname],
  );

  return {
    activeTab,
    changeTab,
  };
}
