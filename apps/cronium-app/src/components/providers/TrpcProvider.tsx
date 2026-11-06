"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import React, { useState } from "react";
import { createQueryClient } from "@/lib/query-client";
import { trpc, trpcClient } from "@/lib/trpc";

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
