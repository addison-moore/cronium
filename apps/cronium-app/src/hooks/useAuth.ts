"use client";

import { useMemo } from "react";
import { UserRole } from "@/shared/schema";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
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
  } = trpc.userAuth.getCurrentUser.useQuery(undefined, {
    enabled: !!session?.user?.id,
    retry: false,
    ...QUERY_OPTIONS.static,
  });

  // Transform userData to match the expected User type. Memoized so the
  // object's identity is stable across renders — consumers put `user` in
  // effect dependency arrays, and a per-render literal re-runs those effects
  // on every render.
  const user: User | null = useMemo(
    () =>
      userData
        ? {
            id: userData.id,
            email: userData.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            profileImageUrl: userData.profileImageUrl,
            role: userData.role,
          }
        : null,
    [userData],
  );

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
