/**
 * This component initializes the Express API server and script scheduler
 * by calling our tRPC system.startServices mutation when the app loads.
 */
"use client";

import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

export function ServiceInitializer() {
  // tRPC mutation for starting services
  const startServicesMutation = trpc.system.startServices.useMutation({
    onSuccess: (data) => {
      console.log("Services initialized successfully:", data.message);
    },
    onError: (error) => {
      console.error("Failed to initialize services:", error.message);
    },
  });

  useEffect(() => {
    const initializeServices = async () => {
      try {
        await startServicesMutation.mutateAsync();
      } catch (error) {
        // Error is already handled by the mutation's onError callback
        console.error("Error initializing services:", error);
      }
    };

    void initializeServices();
  }, []);

  // This component doesn't render anything visible
  return null;
}

export default ServiceInitializer;
