'use client';

import { useQuery } from "@tanstack/react-query";
import { UserRole } from "@/shared/schema";
import { useSession } from "next-auth/react";

type User = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role: UserRole;
};

/**
 * Custom hook for accessing the authenticated user
 * This uses next-auth session and adds additional 
 * functionality to fetch the full user profile
 */
export function useAuth() {
  // Get session from next-auth
  const { data: session, status: sessionStatus } = useSession();

  // Fetch the full user data from our API
  const {
    data: user,
    isLoading: isUserLoading,
    error,
  } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      const res = await fetch('/api/auth/user');
      if (!res.ok) {
        // Don't throw error, just return null for unauthenticated
        if (res.status === 401) {
          return null;
        }
        throw new Error('Failed to fetch user data');
      }
      return res.json();
    },
    enabled: !!session?.user?.id,
    retry: false,
  });

  return {
    user,
    isLoading: sessionStatus === "loading" || isUserLoading,
    isAuthenticated: !!session?.user,
    role: user?.role || session?.user?.role,
    isAdmin: user?.role === UserRole.ADMIN || session?.user?.role === UserRole.ADMIN,
    error,
    session,
  };
}