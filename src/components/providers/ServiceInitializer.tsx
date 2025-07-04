/**
 * This component initializes the Express API server and script scheduler
 * by calling our initialization API route when the app loads.
 */
"use client";

import { useEffect, useState } from "react";

export function ServiceInitializer() {
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeServices = async () => {
      try {
        const response = await fetch("/api/start-services");
        const data = await response.json();

        if (response.ok) {
          console.log("Services initialized successfully:", data.message);
          setInitialized(true);
        } else {
          console.error("Failed to initialize services:", data.error);
          setError(data.error);
        }
      } catch (error) {
        console.error("Error initializing services:", error);
        setError(error instanceof Error ? error.message : "Unknown error");
      }
    };

    initializeServices();
  }, []);

  // This component doesn't render anything visible
  return null;
}

export default ServiceInitializer;
