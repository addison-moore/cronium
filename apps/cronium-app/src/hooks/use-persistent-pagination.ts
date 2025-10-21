"use client";

import { useState, useEffect, useCallback } from "react";

const PAGINATION_STORAGE_KEY = "cronium_pagination_items_per_page";
const DEFAULT_ITEMS_PER_PAGE = 20;

export function usePersistentPagination(
  initialValue: number = DEFAULT_ITEMS_PER_PAGE,
) {
  // Always use initialValue for SSR to avoid hydration mismatch
  const [itemsPerPage, setItemsPerPageState] = useState<number>(initialValue);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load from localStorage after hydration
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PAGINATION_STORAGE_KEY);
      if (stored) {
        const parsedValue = parseInt(stored, 10);
        if (!isNaN(parsedValue) && parsedValue > 0) {
          setItemsPerPageState(parsedValue);
        }
      }
    } catch (error) {
      console.error("Error loading pagination settings:", error);
    }
    setIsInitialized(true);
  }, []);

  // Save to localStorage whenever value changes
  const setItemsPerPage = useCallback((value: number) => {
    setItemsPerPageState(value);

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(PAGINATION_STORAGE_KEY, value.toString());
      } catch (error) {
        console.error("Error saving pagination settings:", error);
      }
    }
  }, []);

  return {
    itemsPerPage,
    setItemsPerPage,
    isInitialized,
  };
}
