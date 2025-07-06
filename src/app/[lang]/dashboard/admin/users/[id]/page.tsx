"use client";

import React, { useState } from "react";
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
import { trpc } from "@/lib/trpc";

export default function UserDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const tCommon = useTranslations("Common");

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const userId = typeof params.id === "string" ? params.id : "";

  // Fetch user details using tRPC
  const {
    data: user,
    isLoading,
    refetch: refetchUser,
    error: userError,
  } = trpc.admin.getUser.useQuery(
    { id: userId },
    {
      enabled: !!userId,
    },
  );

  // Handle query error
  React.useEffect(() => {
    if (userError) {
      console.error("Error fetching user:", userError);
      toast({
        title: tCommon("Error"),
        description: "Failed to load user details. Please try again.",
        variant: "destructive",
      });
    }
  }, [userError, tCommon, toast]);

  // tRPC mutations
  const updateUserMutation = trpc.admin.updateUser.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "User updated successfully",
      });
      void refetchUser();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to update user",
        variant: "destructive",
      });
    },
  });

  const toggleUserStatusMutation = trpc.admin.toggleUserStatus.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "User status updated successfully",
      });
      void refetchUser();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to update user status",
        variant: "destructive",
      });
    },
  });

  const resendInvitationMutation = trpc.admin.resendInvitation.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Invitation email sent successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to resend invitation",
        variant: "destructive",
      });
    },
  });

  const deleteUserMutation = trpc.admin.bulkUserOperation.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "User deleted successfully",
      });
      router.push("/en/dashboard/admin?tab=users");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to delete user",
        variant: "destructive",
      });
    },
  });

  function updateUserRole(newRole: UserRole): void {
    if (!user) return;
    updateUserMutation.mutate({ id: user.id, role: newRole });
  }

  function updateUserStatus(newStatus: UserStatus): void {
    if (!user) return;
    toggleUserStatusMutation.mutate({ id: user.id, status: newStatus });
  }

  function resendInvitation(): void {
    if (!user) return;
    resendInvitationMutation.mutate({ id: user.id });
  }

  function deleteUser(): void {
    if (!user) return;
    deleteUserMutation.mutate({
      userIds: [user.id],
      operation: "delete",
    });
    setIsDeleteDialogOpen(false);
  }

  const isUpdating =
    updateUserMutation.isPending ||
    toggleUserStatusMutation.isPending ||
    resendInvitationMutation.isPending ||
    deleteUserMutation.isPending;

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
                <CardTitle className="text-xl">
                  {user.email ?? "No email"}
                </CardTitle>
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
                <span>Email: {user.email ?? "No email"}</span>
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
