"use client";

import { UserRole } from "@/shared/schema";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { QUERY_OPTIONS } from "@/trpc/shared";

type User = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role: UserRole;
};

/**
 * Custom hook for accessing the authenticated user using tRPC
 * This uses next-auth session and adds additional
 * functionality to fetch the full user profile via tRPC
 */
export function useAuth() {
  // Get session from next-auth
  const { data: session, status: sessionStatus } = useSession();

  // Fetch the full user data using tRPC
  const {
    data: userData,
    isLoading: isUserLoading,
    error,
  } = api.userAuth.getCurrentUser.useQuery(undefined, {
    enabled: !!session?.user?.id,
    retry: false,
    ...QUERY_OPTIONS.static,
  });

  // Transform userData to match the expected User type
  const user: User | null = userData
    ? {
        id: userData.id,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profileImageUrl: userData.profileImageUrl,
        role: userData.role,
      }
    : null;

  return {
    user,
    isLoading: sessionStatus === "loading" || isUserLoading,
    isAuthenticated: !!session?.user,
    role: user?.role ?? session?.user?.role,
    isAdmin:
      user?.role === UserRole.ADMIN || session?.user?.role === UserRole.ADMIN,
    error: error ? (error as unknown as Error) : undefined,
    session,
  };
}
