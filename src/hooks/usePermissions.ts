import { UserRole } from "@/shared/schema";
import { api } from "@/trpc/react";
import { useAuth } from "./useAuth";
import { QUERY_OPTIONS } from "@/trpc/shared";

interface Permissions {
  console: boolean;
  monitoring: boolean;
  localServerAccess: boolean;
}

interface Role {
  id: number;
  name: string;
  description: string;
  permissions: Permissions;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export function usePermissions() {
  const { user } = useAuth();

  // Fetch roles using tRPC
  const { data: roles, isLoading: loading } = api.admin.getRoles.useQuery(
    undefined,
    {
      enabled: !!user && user.role !== UserRole.ADMIN,
      ...QUERY_OPTIONS.stable,
    },
  );

  // Determine permissions based on user role
  let permissions: Permissions = {
    console: false,
    monitoring: false,
    localServerAccess: false,
  };
  let userRole: Role | null = null;

  if (user) {
    // Admin users have all permissions
    if (user.role === UserRole.ADMIN) {
      permissions = {
        console: true,
        monitoring: true,
        localServerAccess: true,
      };
      // Create a synthetic admin role object
      userRole = {
        id: 1,
        name: "Admin",
        description: "Full system access",
        permissions,
        isDefault: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else if (roles) {
      // Find the role that matches the user's role
      const rolesList = roles.items ?? [];
      const matchingRole = rolesList.find(
        (role) => role.name.toLowerCase() === user.role.toLowerCase(),
      );

      if (matchingRole) {
        userRole = matchingRole;
        permissions = matchingRole.permissions;
      } else {
        // Fallback to default user role if no match found
        const defaultRole = rolesList.find(
          (role) => role.isDefault && role.name === "User",
        );
        if (defaultRole) {
          userRole = defaultRole;
          permissions = defaultRole.permissions;
        }
      }
    }
  }

  const hasPermission = (feature: keyof Permissions): boolean => {
    // Admin users always have access to everything
    if (user?.role === UserRole.ADMIN) {
      return true;
    }

    return permissions[feature];
  };

  return {
    permissions,
    userRole,
    hasPermission,
    loading: !user ? false : user.role === UserRole.ADMIN ? false : loading,
  };
}
