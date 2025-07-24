"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Switch } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Shield, Plus, ChevronDown } from "lucide-react";
import { Badge } from "@cronium/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@cronium/ui";

interface Role {
  id: number;
  name: string;
  description: string;
  permissions: {
    console: boolean;
    monitoring: boolean;
    localServerAccess: boolean;
  };
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RolesManagementProps {
  roles: Role[];
  isLoading: boolean;
  onRefresh: () => void;
  onUpdateRole: (
    roleId: number,
    permissions: {
      console: boolean;
      monitoring: boolean;
      localServerAccess: boolean;
    },
  ) => Promise<void>;
}

export function RolesManagement({
  roles,
  isLoading,
  onUpdateRole,
}: RolesManagementProps) {
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);

  const handlePermissionChange = async (
    roleId: number,
    permission: "console" | "monitoring" | "localServerAccess",
    value: boolean,
  ) => {
    try {
      const role = roles.find((r) => r.id === roleId);
      if (!role) return;

      const newPermissions = {
        console: role.permissions.console,
        monitoring: role.permissions.monitoring,
        localServerAccess: role.permissions.localServerAccess,
        [permission]: value,
      };

      // Optimistically update the selected role immediately
      if (selectedRole && selectedRole.id === roleId) {
        setSelectedRole({
          ...selectedRole,
          permissions: newPermissions,
        });
      }

      // Update the server without refreshing the entire component
      await onUpdateRole(roleId, newPermissions);
    } catch (error) {
      console.error("Error updating role permission:", error);
      // Revert the optimistic update on error
      if (selectedRole && selectedRole.id === roleId) {
        const originalRole = roles.find((r) => r.id === roleId);
        if (originalRole) {
          setSelectedRole({
            ...selectedRole,
            permissions: originalRole.permissions, // Revert to original permissions
          });
        }
      }
    }
  };

  // Set default selected role if none selected
  if (!selectedRole && roles.length > 0) {
    setSelectedRole(roles[0] ?? null);
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Roles & Permissions
          </CardTitle>
          <CardDescription>
            Manage user roles and their permissions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-4 text-center">Loading roles...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Roles & Permissions
            </CardTitle>
            <CardDescription>
              Manage user roles and their permissions
            </CardDescription>
          </div>
          <Button
            disabled
            variant="outline"
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Role
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {roles.length > 0 ? (
          <>
            {/* Role Selection Dropdown */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Select Role</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <div className="flex items-center gap-2">
                      {selectedRole?.name ?? "Select a role"}
                      {selectedRole?.isDefault && (
                        <Badge variant="secondary" className="text-xs">
                          Default
                        </Badge>
                      )}
                    </div>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full">
                  {roles.map((role) => (
                    <DropdownMenuItem
                      key={role.id}
                      onClick={() => setSelectedRole(role)}
                      className="flex items-center justify-between"
                    >
                      <span>{role.name}</span>
                      {role.isDefault && (
                        <Badge variant="secondary" className="text-xs">
                          Default
                        </Badge>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Role Details and Permissions */}
            {selectedRole && (
              <div className="border-border space-y-4 rounded-lg border p-4">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="font-semibold">{selectedRole.name}</h3>
                    {selectedRole.isDefault && (
                      <Badge variant="secondary">Default</Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    {selectedRole.description}
                  </p>
                </div>

                <div className="space-y-4">
                  <h4 className="text-sm font-medium">Features</h4>
                  <div className="space-y-3">
                    <div className="border-border flex items-center justify-between border-b py-2">
                      <div>
                        <Label
                          htmlFor={`console-${selectedRole.id}`}
                          className="text-sm font-medium"
                        >
                          Console Access
                        </Label>
                        <p className="text-xs text-gray-500">
                          Access to server terminal and command execution
                        </p>
                      </div>
                      <Switch
                        id={`console-${selectedRole.id}`}
                        checked={selectedRole.permissions.console}
                        onCheckedChange={(checked) =>
                          handlePermissionChange(
                            selectedRole.id,
                            "console",
                            checked,
                          )
                        }
                      />
                    </div>

                    <div className="border-border flex items-center justify-between border-b py-2">
                      <div>
                        <Label
                          htmlFor={`monitoring-${selectedRole.id}`}
                          className="text-sm font-medium"
                        >
                          Monitoring Access
                        </Label>
                        <p className="text-xs text-gray-500">
                          View system performance and application metrics
                        </p>
                      </div>
                      <Switch
                        id={`monitoring-${selectedRole.id}`}
                        checked={selectedRole.permissions.monitoring}
                        onCheckedChange={(checked) =>
                          handlePermissionChange(
                            selectedRole.id,
                            "monitoring",
                            checked,
                          )
                        }
                      />
                    </div>

                    <div className="border-border flex items-center justify-between border-b py-2">
                      <div>
                        <Label
                          htmlFor={`localServerAccess-${selectedRole.id}`}
                          className="text-sm font-medium"
                        >
                          Local Server Access
                        </Label>
                        <p className="text-xs text-gray-500">
                          Create and edit events/workflows that execute on the
                          local server
                        </p>
                      </div>
                      <Switch
                        id={`localServerAccess-${selectedRole.id}`}
                        checked={selectedRole.permissions.localServerAccess}
                        onCheckedChange={(checked) =>
                          handlePermissionChange(
                            selectedRole.id,
                            "localServerAccess",
                            checked,
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center text-gray-500">No roles found</div>
        )}
      </CardContent>
    </Card>
  );
}
