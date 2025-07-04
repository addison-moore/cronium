"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, Tab } from "@/components/ui/tabs";
import { useHashTabNavigation } from "@/hooks/useHashTabNavigation";
import { Mail, Users, Sparkles, UserCog, Shield } from "lucide-react";
import { z } from "zod";
import { UserRole, UserStatus } from "@/shared/schema";
import {
  SmtpSettings,
  RegistrationSettings,
  AiSettings,
  UsersManagement,
  RolesManagement,
} from "@/components/admin";
import { trpc } from "@/lib/trpc";
import { toast } from "@/components/ui/use-toast";

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

interface SystemSettings {
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFromEmail?: string;
  smtpFromName?: string;
  smtpEnabled?: boolean;
  allowRegistration?: boolean;
  requireAdminApproval?: boolean;
  aiEnabled?: boolean;
  aiModel?: string;
  openaiApiKey?: string;
  inviteOnly?: boolean;
  maxUsers?: number;
  maxEventsPerUser?: number;
  maxWorkflowsPerUser?: number;
  maxServersPerUser?: number;
  enableRegistration?: boolean;
  enableGuestAccess?: boolean;
  defaultUserRole?: UserRole;
  sessionTimeout?: number;
  logRetentionDays?: number;
}

interface User {
  id: string;
  email: string | null;
  username: string | null;
  password?: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl?: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLogin: Date | null;
  inviteToken?: string | null;
}

// Validation schemas
const smtpSettingsSchema = z.object({
  smtpHost: z.string().min(1, "SMTP host is required"),
  smtpPort: z.string().regex(/^\d+$/, "Port must be a number"),
  smtpUser: z.string().min(1, "SMTP user is required"),
  smtpPassword: z.string().min(1, "SMTP password is required"),
  smtpFromEmail: z.string().email("Invalid email address"),
  smtpFromName: z.string().min(1, "From name is required"),
  smtpEnabled: z.boolean().optional(),
});

const registrationSettingsSchema = z.object({
  allowRegistration: z.boolean().optional(),
  requireAdminApproval: z.boolean().optional(),
  inviteOnly: z.boolean().optional(),
});

const aiSettingsSchema = z.object({
  aiEnabled: z.boolean().optional(),
  aiModel: z.string().min(1, "AI model selection is required"),
  openaiApiKey: z.string().min(1, "OpenAI API key is required"),
});

export default function AdminPage() {
  const router = useRouter();
  const t = useTranslations("Admin");
  const tCommon = useTranslations("Common");

  // Hash-based tab navigation
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "smtp",
    validTabs: ["smtp", "registration", "ai", "users", "roles"],
  });

  // tRPC queries and mutations
  const {
    data: systemSettings,
    isLoading: isSettingsLoading,
    refetch: refetchSettings,
  } = trpc.admin.getSystemSettings.useQuery();

  const {
    data: usersData,
    isLoading: isUsersLoading,
    refetch: refetchUsers,
  } = trpc.admin.getUsers.useQuery({
    limit: 100,
    offset: 0,
  });

  const updateSystemSettingsMutation =
    trpc.admin.updateSystemSettings.useMutation({
      onSuccess: () => {
        toast({
          title: "Settings saved",
          description: "System settings have been updated successfully.",
        });
        refetchSettings();
      },
    });

  const inviteUserMutation = trpc.admin.inviteUser.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: `Invitation sent to ${data.email}`,
      });
      refetchUsers();
    },
  });

  const updateUserMutation = trpc.admin.updateUser.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "User updated successfully",
      });
      refetchUsers();
    },
  });

  const toggleUserStatusMutation = trpc.admin.toggleUserStatus.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "User status updated successfully",
      });
      refetchUsers();
    },
  });

  const bulkUserOperationMutation = trpc.admin.bulkUserOperation.useMutation({
    onSuccess: (data) => {
      const successCount = data.results.filter((r) => r.success).length;
      const failureCount = data.results.filter((r) => !r.success).length;

      if (failureCount === 0) {
        toast({
          title: "Success",
          description: `Operation completed successfully on ${successCount} users`,
        });
      } else {
        toast({
          title: "Partial Success",
          description: `${successCount} successful, ${failureCount} failed`,
          variant: "destructive",
        });
      }
      refetchUsers();
    },
  });

  const users = usersData?.users || [];
  const settings: SystemSettings = (systemSettings || {}) as SystemSettings;
  const [roles, setRoles] = useState<Role[]>([]);
  const [isRolesLoading, setIsRolesLoading] = useState(true);

  // Fetch roles (not implemented in tRPC yet, using REST fallback)
  useEffect(() => {
    fetchRoles();
  }, []);

  async function fetchRoles() {
    setIsRolesLoading(true);
    try {
      const response = await fetch("/api/admin/roles");
      if (!response.ok) {
        throw new Error("Failed to fetch roles");
      }
      const data = await response.json();
      setRoles(data);
    } catch (error) {
      console.error("Error fetching roles:", error);
      toast({
        title: "Error",
        description: "Failed to load roles. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRolesLoading(false);
    }
  }

  async function saveSmtpSettings(data: z.infer<typeof smtpSettingsSchema>) {
    updateSystemSettingsMutation.mutate({
      maxUsers: settings.maxUsers,
      maxEventsPerUser: settings.maxEventsPerUser,
      maxWorkflowsPerUser: settings.maxWorkflowsPerUser,
      maxServersPerUser: settings.maxServersPerUser,
      enableRegistration: settings.enableRegistration,
      enableGuestAccess: settings.enableGuestAccess,
      defaultUserRole: settings.defaultUserRole,
      sessionTimeout: settings.sessionTimeout,
      logRetentionDays: settings.logRetentionDays,
      // Add SMTP settings (these would need to be added to the schema)
      ...data,
    });
  }

  async function saveRegistrationSettings(
    data: z.infer<typeof registrationSettingsSchema>,
  ) {
    updateSystemSettingsMutation.mutate({
      ...settings,
      ...data,
    });
  }

  async function saveAiSettings(data: z.infer<typeof aiSettingsSchema>) {
    updateSystemSettingsMutation.mutate({
      ...settings,
      ...data,
    });
  }

  async function handleInviteUser(data: { email: string; role: UserRole }) {
    inviteUserMutation.mutate(data);
  }

  async function handleDeleteUser(userId: string) {
    // Using bulk operation for delete
    bulkUserOperationMutation.mutate({
      userIds: [userId],
      operation: "delete",
    });
  }

  async function handleUpdateUserStatus(userId: string, status: UserStatus) {
    toggleUserStatusMutation.mutate({ id: userId, status });
  }

  async function handleUpdateUserRole(userId: string, role: UserRole) {
    updateUserMutation.mutate({ id: userId, role });
  }

  async function handleResendInvitation(userId: string) {
    bulkUserOperationMutation.mutate({
      userIds: [userId],
      operation: "resend_invite",
    });
  }

  async function handleApproveUser(userId: string) {
    toggleUserStatusMutation.mutate({ id: userId, status: UserStatus.ACTIVE });
  }

  async function handleDenyUser(userId: string) {
    bulkUserOperationMutation.mutate({
      userIds: [userId],
      operation: "delete",
    });
  }

  async function handleUpdateRole(
    roleId: number,
    permissions: {
      console: boolean;
      monitoring: boolean;
      localServerAccess: boolean;
    },
  ) {
    try {
      const response = await fetch("/api/admin/roles", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roleId, permissions }),
      });

      if (!response.ok) {
        throw new Error("Failed to update role permissions");
      }

      // Update the local roles state instead of refetching
      setRoles((prevRoles) =>
        prevRoles.map((role) =>
          role.id === roleId ? { ...role, permissions } : role,
        ),
      );
    } catch (error: any) {
      throw error; // Re-throw to let the component handle it
    }
  }

  return (
    <div className="container mx-auto space-y-8 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("Title")}</h1>
          <p className="text-gray-500">{t("Description")}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={changeTab} className="w-full">
        <TabsList>
          <Tab value="smtp" icon={Mail} label={t("Tabs.Email")} />
          <Tab
            value="registration"
            icon={Users}
            label={t("Tabs.Registration")}
          />
          <Tab value="ai" icon={Sparkles} label={t("Tabs.AiAssistant")} />
          <Tab value="users" icon={UserCog} label="Users" />
          <Tab value="roles" icon={Shield} label="Roles" />
        </TabsList>

        <TabsContent value="smtp">
          <SmtpSettings settings={settings} onSave={saveSmtpSettings} />
        </TabsContent>

        <TabsContent value="registration">
          <RegistrationSettings
            settings={settings}
            onSave={saveRegistrationSettings}
          />
        </TabsContent>

        <TabsContent value="ai">
          <AiSettings settings={settings} onSave={saveAiSettings} />
        </TabsContent>

        <TabsContent value="users">
          <UsersManagement
            users={users as any}
            isLoading={isUsersLoading}
            onRefresh={async () => {
              await refetchUsers();
            }}
            onInviteUser={handleInviteUser}
            onDeleteUser={handleDeleteUser}
            onUpdateUserStatus={handleUpdateUserStatus}
            onUpdateUserRole={handleUpdateUserRole}
            onResendInvitation={handleResendInvitation}
            onApproveUser={handleApproveUser}
            onDenyUser={handleDenyUser}
          />
        </TabsContent>

        <TabsContent value="roles">
          <RolesManagement
            roles={roles}
            isLoading={isRolesLoading}
            onRefresh={fetchRoles}
            onUpdateRole={handleUpdateRole}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
