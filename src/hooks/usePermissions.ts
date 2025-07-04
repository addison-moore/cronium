import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';

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
}

export function usePermissions() {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<Permissions>({
    console: false,
    monitoring: false,
    localServerAccess: false,
  });
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUserPermissions() {
      try {
        if (!user) {
          setLoading(false);
          return;
        }

        // Admin users have all permissions
        if (user.role === 'ADMIN') {
          setPermissions({
            console: true,
            monitoring: true,
            localServerAccess: true,
          });
          setLoading(false);
          return;
        }

        // Fetch user's role and permissions
        const response = await fetch('/api/admin/roles');
        if (response.ok) {
          const roles: Role[] = await response.json();
          
          // For now, assign the default "users" role to all non-admin users
          const defaultRole = roles.find(role => role.isDefault);
          if (defaultRole) {
            setUserRole(defaultRole);
            setPermissions(defaultRole.permissions);
          }
        }
      } catch (error) {
        console.error('Error fetching permissions:', error);
        // Default to no permissions on error
        setPermissions({
          console: false,
          monitoring: false,
          localServerAccess: false,
        });
      } finally {
        setLoading(false);
      }
    }

    fetchUserPermissions();
  }, [user]);

  const hasPermission = (feature: keyof Permissions): boolean => {
    // Admin users always have access to everything
    if (user?.role === 'ADMIN') {
      return true;
    }
    
    return permissions[feature];
  };

  return {
    permissions,
    userRole,
    hasPermission,
    loading,
  };
}