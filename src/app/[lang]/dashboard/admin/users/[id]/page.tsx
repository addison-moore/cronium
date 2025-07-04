"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  User,
  Mail,
  Calendar,
  Shield,
  UserCheck,
  UserX,
  Trash,
  SendHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/use-toast";
import { UserRole, UserStatus } from "@/shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface UserDetails {
  id: string;
  email: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLogin: string | null;
  inviteToken?: string | null;
  inviteExpiry?: string | null;
}

export default function UserDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const tCommon = useTranslations("Common");

  const [user, setUser] = useState<UserDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (params.id) {
      fetchUser(params.id as string);
    }
  }, [params.id]);

  async function fetchUser(userId: string) {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch user");
      }
      const userData = await response.json();
      setUser(userData);
    } catch (error) {
      console.error("Error fetching user:", error);
      toast({
        title: tCommon("Error"),
        description: "Failed to load user details. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function updateUserRole(newRole: UserRole) {
    if (!user) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: newRole }),
      });

      if (!response.ok) {
        throw new Error("Failed to update user role");
      }

      setUser({ ...user, role: newRole });
      toast({
        title: "Success",
        description: "User role updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message ?? "Failed to update user role",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  }

  async function updateUserStatus(newStatus: UserStatus) {
    if (!user) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error("Failed to update user status");
      }

      setUser({ ...user, status: newStatus });
      toast({
        title: "Success",
        description: "User status updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message ?? "Failed to update user status",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  }

  async function resendInvitation() {
    if (!user) return;

    setIsUpdating(true);
    try {
      const response = await fetch(
        `/api/admin/users/${user.id}/resend-invitation`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message ?? "Failed to resend invitation");
      }

      toast({
        title: "Success",
        description: "Invitation email sent successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message ?? "Failed to resend invitation",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  }

  async function deleteUser() {
    if (!user) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete user");
      }

      toast({
        title: "Success",
        description: "User deleted successfully",
      });

      router.push("/en/dashboard/admin?tab=users");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message ?? "Failed to delete user",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
      setIsDeleteDialogOpen(false);
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading user details...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">User not found.</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/en/dashboard/admin#users")}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Users
        </Button>
      </div>

      {/* User Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <User className="h-6 w-6 text-gray-500" />
              <div>
                <CardTitle className="text-xl">{user.email}</CardTitle>
                <CardDescription>
                  {user.firstName || user.lastName
                    ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
                    : "No name provided"}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={user.status} />
              <Badge
                variant={
                  user.role === UserRole.ADMIN ? "destructive" : "default"
                }
              >
                {user.role}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Mail className="h-4 w-4" />
                <span>Email: {user.email}</span>
              </div>
              {user.username && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <User className="h-4 w-4" />
                  <span>Username: @{user.username}</span>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Calendar className="h-4 w-4" />
                <span>
                  Created: {new Date(user.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Calendar className="h-4 w-4" />
                <span>
                  Last Login:{" "}
                  {user.lastLogin
                    ? new Date(user.lastLogin).toLocaleDateString()
                    : "Never"}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Management Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            User Management
          </CardTitle>
          <CardDescription>
            Manage user role, status, and perform administrative actions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Role Management */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <Select
              value={user.role}
              onValueChange={(value) => updateUserRole(value as UserRole)}
              disabled={isUpdating}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UserRole.USER}>User</SelectItem>
                <SelectItem value={UserRole.ADMIN}>Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Status Actions */}
          <div className="space-y-3">
            <label className="text-sm font-medium">Status Actions</label>
            <div className="flex flex-wrap gap-2">
              {user.status === UserStatus.INVITED && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resendInvitation}
                  disabled={isUpdating}
                  className="flex items-center gap-2"
                >
                  <SendHorizontal className="h-4 w-4" />
                  Resend Invitation
                </Button>
              )}

              {user.status === UserStatus.ACTIVE ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateUserStatus(UserStatus.DISABLED)}
                  disabled={isUpdating}
                  className="flex items-center gap-2 text-orange-600 hover:text-orange-700"
                >
                  <UserX className="h-4 w-4" />
                  Disable User
                </Button>
              ) : user.status === UserStatus.DISABLED ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateUserStatus(UserStatus.ACTIVE)}
                  disabled={isUpdating}
                  className="flex items-center gap-2 text-green-600 hover:text-green-700"
                >
                  <UserCheck className="h-4 w-4" />
                  Activate User
                </Button>
              ) : null}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="border-border border-t pt-6">
            <div className="space-y-3">
              <label className="text-sm font-medium text-red-600">
                Danger Zone
              </label>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setIsDeleteDialogOpen(true)}
                disabled={isUpdating}
                className="flex items-center gap-2"
              >
                <Trash className="h-4 w-4" />
                Delete User
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this user? This action cannot be
              undone. All user data, including their events and logs, will be
              permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteUser}
              disabled={isUpdating}
              className="bg-red-600 hover:bg-red-700"
            >
              {isUpdating ? "Deleting..." : "Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
