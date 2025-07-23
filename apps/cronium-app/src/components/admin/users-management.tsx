"use client";

import React, { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserRole, UserStatus } from "@/shared/schema";
import {
  UserCog,
  UserPlus,
  Search,
  UserCheck,
  UserX,
  SendHorizontal,
  Trash,
  RefreshCw,
  MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { StatusBadge } from "@/components/ui/status-badge";
import { StandardizedTableLink } from "@/components/ui/standardized-table";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsSection } from "./settings-section";

interface User {
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
}

interface UsersManagementProps {
  users: User[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onInviteUser: (data: { email: string; role: UserRole }) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
  onUpdateUserStatus: (userId: string, status: UserStatus) => Promise<void>;
  onUpdateUserRole: (userId: string, role: UserRole) => Promise<void>;
  onResendInvitation: (userId: string) => Promise<void>;
  onApproveUser: (userId: string) => Promise<void>;
  onDenyUser: (userId: string) => Promise<void>;
}

const inviteUserSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address" }),
  role: z.nativeEnum(UserRole),
});

type InviteUserFormData = z.infer<typeof inviteUserSchema>;

export function UsersManagement({
  users,
  isLoading,
  onRefresh,
  onInviteUser,
  onDeleteUser,
  onUpdateUserStatus,
  onResendInvitation,
  onApproveUser,
  onDenyUser,
}: UsersManagementProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredUsers, setFilteredUsers] = useState<User[]>(users);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  // Calculate pagination
  const totalItems = filteredUsers.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

  const inviteForm = useForm<InviteUserFormData>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: {
      email: "",
      role: UserRole.USER,
    },
  });

  // Filter users when search query or users change
  React.useEffect(() => {
    if (searchQuery.trim() === "") {
      setFilteredUsers(users);
    } else {
      const lowerCaseQuery = searchQuery.toLowerCase();
      setFilteredUsers(
        users.filter(
          (user) =>
            (user.email.toLowerCase().includes(lowerCaseQuery) ||
              user.username?.toLowerCase().includes(lowerCaseQuery)) ??
            user.firstName?.toLowerCase().includes(lowerCaseQuery) ??
            user.lastName?.toLowerCase().includes(lowerCaseQuery),
        ),
      );
    }
    // Reset to first page when search results change
    setCurrentPage(1);
  }, [users, searchQuery]);

  // Pagination handlers
  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    setItemsPerPage(newSize);
    setCurrentPage(1); // Reset to first page when changing page size
  };

  const handleInviteUser = async (data: InviteUserFormData) => {
    setIsSubmitting(true);
    try {
      await onInviteUser(data);
      inviteForm.reset();
      setIsInviteDialogOpen(false);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to send invitation";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await onDeleteUser(userId);
      setIsDeleteDialogOpen(false);
      setSelectedUserId(null);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to delete user";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleResendInvitation = async (userId: string) => {
    try {
      await onResendInvitation(userId);
      toast({
        title: "Success",
        description: "Invitation email sent successfully",
        variant: "default",
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to resend invitation";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleApproveUser = async (userId: string) => {
    try {
      await onApproveUser(userId);
      toast({
        title: "Success",
        description: "User approved successfully",
        variant: "default",
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to approve user";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleDenyUser = async (userId: string) => {
    try {
      await onDenyUser(userId);
      toast({
        title: "Success",
        description: "User registration denied",
        variant: "default",
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to deny user";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case UserRole.ADMIN:
        return <Badge variant="destructive">Admin</Badge>;
      case UserRole.USER:
        return <Badge variant="default">User</Badge>;
      default:
        return <Badge variant="secondary">{role}</Badge>;
    }
  };

  return (
    <SettingsSection
      title="User Management"
      description="Manage users, roles, and permissions"
      icon={UserCog}
    >
      <div className="space-y-6">
        {/* Header Actions */}
        <div className="flex flex-col justify-between gap-4 sm:flex-row">
          <div className="flex max-w-sm flex-1 items-center space-x-2">
            <Search className="h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onRefresh}
              disabled={isLoading}
              className="flex items-center gap-2"
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>

            <Dialog
              open={isInviteDialogOpen}
              onOpenChange={setIsInviteDialogOpen}
            >
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Invite User
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite New User</DialogTitle>
                  <DialogDescription>
                    Send an invitation email to a new user
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={inviteForm.handleSubmit(handleInviteUser)}>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="user@example.com"
                        aria-describedby={
                          inviteForm.formState.errors.email
                            ? "email-error"
                            : undefined
                        }
                        {...inviteForm.register("email")}
                      />
                      {inviteForm.formState.errors.email && (
                        <p id="email-error" className="text-sm text-red-600">
                          {inviteForm.formState.errors.email.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Controller
                        name="role"
                        control={inviteForm.control}
                        render={({ field }) => (
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UserRole.USER}>
                                User
                              </SelectItem>
                              <SelectItem value={UserRole.ADMIN}>
                                Admin
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                  </div>

                  <DialogFooter className="mt-6">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsInviteDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex items-center gap-2"
                    >
                      <SendHorizontal className="h-4 w-4" />
                      {isSubmitting ? "Sending..." : "Send Invitation"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Users Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center">
                  Loading users...
                </TableCell>
              </TableRow>
            ) : totalItems === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center">
                  {searchQuery
                    ? "No users found matching your search."
                    : "No users found."}
                </TableCell>
              </TableRow>
            ) : (
              paginatedUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div>
                      <StandardizedTableLink
                        href={`/en/dashboard/admin/users/${user.id}`}
                      >
                        {user.email}
                      </StandardizedTableLink>
                      {(user.firstName ?? user.lastName) && (
                        <div className="text-sm text-gray-500">
                          {[user.firstName, user.lastName]
                            .filter(Boolean)
                            .join(" ")}
                        </div>
                      )}
                      {user.username && (
                        <div className="text-sm text-gray-500">
                          @{user.username}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{getRoleBadge(user.role)}</TableCell>
                  <TableCell>
                    <StatusBadge status={user.status} size="sm" />
                  </TableCell>
                  <TableCell>
                    {user.lastLogin
                      ? new Date(user.lastLogin).toLocaleDateString()
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {user.status === UserStatus.INVITED && (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleResendInvitation(user.id)}
                              className="text-blue-600"
                            >
                              <SendHorizontal className="mr-2 h-4 w-4" />
                              Resend Invitation
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}

                        {user.status === UserStatus.PENDING && (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleApproveUser(user.id)}
                              className="text-green-600"
                            >
                              <UserCheck className="mr-2 h-4 w-4" />
                              Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDenyUser(user.id)}
                              className="text-red-600"
                            >
                              <UserX className="mr-2 h-4 w-4" />
                              Deny
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}

                        {user.status === UserStatus.ACTIVE ? (
                          <DropdownMenuItem
                            onClick={() =>
                              onUpdateUserStatus(user.id, UserStatus.DISABLED)
                            }
                            className="text-orange-600"
                          >
                            <UserX className="mr-2 h-4 w-4" />
                            Disable User
                          </DropdownMenuItem>
                        ) : user.status === UserStatus.DISABLED ? (
                          <DropdownMenuItem
                            onClick={() =>
                              onUpdateUserStatus(user.id, UserStatus.ACTIVE)
                            }
                            className="text-green-600"
                          >
                            <UserCheck className="mr-2 h-4 w-4" />
                            Activate User
                          </DropdownMenuItem>
                        ) : null}

                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedUserId(user.id);
                            setIsDeleteDialogOpen(true);
                          }}
                          className="text-red-600"
                        >
                          <Trash className="mr-2 h-4 w-4" />
                          Delete User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination Controls */}
        {totalItems > 0 && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              {/* Items per page selector */}
              <div className="flex items-center space-x-2">
                <span className="text-muted-foreground text-sm">
                  Items per page:
                </span>
                <Select
                  value={itemsPerPage.toString()}
                  onValueChange={(value) =>
                    handlePageSizeChange(parseInt(value))
                  }
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Pagination component */}
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                itemsPerPage={itemsPerPage}
                totalItems={totalItems}
              />
            </div>
          </div>
        )}

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
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  selectedUserId && handleDeleteUser(selectedUserId)
                }
                className="bg-red-600 hover:bg-red-700"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SettingsSection>
  );
}
