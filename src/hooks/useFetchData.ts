import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/ui/use-toast";

interface UseFetchDataOptions<T> {
  url: string;
  initialData?: T | null;
  errorMessage?: string;
  onSuccess?: (data: T) => void;
  transform?: (data: any) => T;
  dependencies?: any[];
  autoFetch?: boolean;
}

/**
 * A custom hook for fetching data with standardized loading, error, and refresh handling
 */
export function useFetchData<T>({
  url,
  initialData = null,
  errorMessage = "Failed to fetch data. Please try again.",
  onSuccess,
  transform = (data) => data as T,
  dependencies = [],
  autoFetch = true,
}: UseFetchDataOptions<T>) {
  const [data, setData] = useState<T>(initialData as T);
  const [isLoading, setIsLoading] = useState(autoFetch);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { toast } = useToast();

  const fetchData = useCallback(
    async (showToastOnError = true) => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(url, {
          credentials: "include", // Include cookies for session authentication
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        // First get the response as text to handle empty responses
        const text = await response.text();

        // Handle empty responses
        if (!text) {
          const emptyData = transform([]);
          setData(emptyData);
          setLastUpdated(new Date());
          return emptyData;
        }

        // Try to parse the JSON with error handling
        let rawData;
        try {
          rawData = JSON.parse(text);
        } catch (parseError) {
          console.error("Error parsing JSON response:", parseError);
          throw new Error("Invalid JSON response");
        }

        // Ensure rawData is an array if it's expected to be
        if (Array.isArray(initialData) && !Array.isArray(rawData)) {
          rawData = Array.isArray(rawData) ? rawData : [];
        }

        const transformedData = transform(rawData);

        setData(transformedData);
        setLastUpdated(new Date());

        if (onSuccess) {
          onSuccess(transformedData);
        }

        return transformedData;
      } catch (error) {
        console.error("Error fetching data:", error);

        setError(errorMessage);

        if (showToastOnError) {
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }

        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [url, transform, onSuccess, errorMessage, toast],
  );

  // Fetch data when component mounts or dependencies change
  useEffect(() => {
    if (autoFetch) {
      fetchData(false); // Don't show toast on initial load
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, autoFetch, ...(dependencies || [])]);

  // Function to manually refresh data
  const refreshData = () => fetchData(true);

  return {
    data,
    isLoading,
    error,
    lastUpdated,
    refreshData,
  };
}
