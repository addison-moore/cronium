"use client";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, Tab } from "@/components/ui/tabs";
import { useHashTabNavigation } from "@/hooks/useHashTabNavigation";
import { Mail, Users, Sparkles, UserCog, Shield } from "lucide-react";
import { z } from "zod";
import { UserStatus } from "@/shared/schema";
import type { UserRole } from "@/shared/schema";
import {
  SmtpSettings,
  RegistrationSettings,
  AiSettings,
  UsersManagement,
  RolesManagement,
} from "@/components/admin";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";
import { toast } from "@/components/ui/use-toast";

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
type SmtpSettingsData = z.infer<typeof smtpSettingsSchema>;

const registrationSettingsSchema = z.object({
  allowRegistration: z.boolean().optional(),
  requireAdminApproval: z.boolean().optional(),
  inviteOnly: z.boolean().optional(),
});
type RegistrationSettingsData = z.infer<typeof registrationSettingsSchema>;

const aiSettingsSchema = z.object({
  aiEnabled: z.boolean().optional(),
  aiModel: z.string().min(1, "AI model selection is required"),
  openaiApiKey: z.string().min(1, "OpenAI API key is required"),
});
type AiSettingsData = z.infer<typeof aiSettingsSchema>;

export default function AdminPage() {
  const t = useTranslations("Admin");

  // Hash-based tab navigation
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "smtp",
    validTabs: ["smtp", "registration", "ai", "users", "roles"],
  });

  // tRPC queries and mutations
  const { data: systemSettings, refetch: refetchSettings } =
    trpc.admin.getSystemSettings.useQuery(undefined, QUERY_OPTIONS.static);

  const {
    data: usersData,
    isLoading: isUsersLoading,
    refetch: refetchUsers,
  } = trpc.admin.getUsers.useQuery(
    {
      limit: 100,
      offset: 0,
    },
    QUERY_OPTIONS.dynamic,
  );

  const updateSystemSettingsMutation =
    trpc.admin.updateSystemSettings.useMutation({
      onSuccess: () => {
        toast({
          title: "Settings saved",
          description: "System settings have been updated successfully.",
        });
        void refetchSettings();
      },
    });

  const inviteUserMutation = trpc.admin.inviteUser.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: `Invitation sent to ${String(data.email ?? "user")}`,
      });
      void refetchUsers();
    },
  });

  const updateUserMutation = trpc.admin.updateUser.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "User updated successfully",
      });
      void refetchUsers();
    },
  });

  const toggleUserStatusMutation = trpc.admin.toggleUserStatus.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "User status updated successfully",
      });
      void refetchUsers();
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
      void refetchUsers();
    },
  });

  const resendInvitationMutation = trpc.admin.resendInvitation.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: `Invitation sent to ${data.email ?? "user"}`,
      });
      void refetchUsers();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message ?? "Failed to resend invitation",
        variant: "destructive",
      });
    },
  });

  const users = usersData?.users ?? [];
  const settings = (systemSettings as SystemSettings) ?? ({} as SystemSettings);

  // Fetch roles using tRPC
  const {
    data: roles,
    isLoading: isRolesLoading,
    refetch: refetchRoles,
  } = trpc.admin.getRoles.useQuery(undefined, QUERY_OPTIONS.stable);

  const updateRolePermissionsMutation =
    trpc.admin.updateRolePermissions.useMutation({
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Role permissions updated successfully",
        });
        void refetchRoles();
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error.message ?? "Failed to update role permissions",
          variant: "destructive",
        });
      },
    });

  async function saveSmtpSettings(data: SmtpSettingsData): Promise<void> {
    // Validate the data using the schema
    const validatedData = smtpSettingsSchema.parse(data);
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
      ...validatedData,
    });
  }

  async function saveRegistrationSettings(
    data: RegistrationSettingsData,
  ): Promise<void> {
    // Validate the data using the schema
    const validatedData = registrationSettingsSchema.parse(data);
    updateSystemSettingsMutation.mutate({
      ...settings,
      ...validatedData,
    });
  }

  async function saveAiSettings(data: AiSettingsData): Promise<void> {
    // Validate the data using the schema
    const validatedData = aiSettingsSchema.parse(data);
    updateSystemSettingsMutation.mutate({
      ...settings,
      ...validatedData,
    });
  }

  async function handleInviteUser(data: {
    email: string;
    role: UserRole;
  }): Promise<void> {
    inviteUserMutation.mutate(data);
  }

  async function handleDeleteUser(userId: string): Promise<void> {
    // Using bulk operation for delete
    bulkUserOperationMutation.mutate({
      userIds: [userId],
      operation: "delete",
    });
  }

  async function handleUpdateUserStatus(
    userId: string,
    status: UserStatus,
  ): Promise<void> {
    toggleUserStatusMutation.mutate({ id: userId, status });
  }

  async function handleUpdateUserRole(
    userId: string,
    role: UserRole,
  ): Promise<void> {
    updateUserMutation.mutate({ id: userId, role });
  }

  async function handleResendInvitation(userId: string): Promise<void> {
    resendInvitationMutation.mutate({ id: userId });
  }

  async function handleApproveUser(userId: string): Promise<void> {
    toggleUserStatusMutation.mutate({ id: userId, status: UserStatus.ACTIVE });
  }

  async function handleDenyUser(userId: string): Promise<void> {
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
  ): Promise<void> {
    updateRolePermissionsMutation.mutate({ roleId, permissions });
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
            users={users.map((user) => ({
              ...user,
              email: user.email ?? "",
              createdAt: user.createdAt.toISOString(),
              updatedAt: user.updatedAt.toISOString(),
              lastLogin: user.lastLogin?.toISOString() ?? null,
            }))}
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
            roles={roles ?? []}
            isLoading={isRolesLoading}
            onRefresh={async () => {
              await refetchRoles();
            }}
            onUpdateRole={handleUpdateRole}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
