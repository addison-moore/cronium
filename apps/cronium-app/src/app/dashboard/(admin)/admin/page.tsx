"use client";
import { PageShell, Tabs, TabsContent, TabsList, Tab } from "@cronium/ui";
import { useHashTabNavigation } from "@/hooks/useHashTabNavigation";
import { Mail, Users, Sparkles, UserCog, Shield, Activity } from "lucide-react";
import SystemHealth from "@/components/admin/system-health";
import { z } from "zod";
import { UserStatus } from "@/shared/schema";
import type { UserRole } from "@/shared/schema";
import { AI_PROVIDER_IDS, type AiProviderId } from "@/shared/ai-providers";
import {
  SmtpSettings,
  RegistrationSettings,
  AiSettings,
  UsersManagement,
  RolesManagement,
} from "@/components/admin";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS, trpcErrorMessage } from "@/trpc/shared";
import { toast } from "@cronium/ui";

interface SystemSettings {
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFromEmail?: string;
  smtpFromName?: string;
  allowRegistration?: boolean;
  requireAdminApproval?: boolean;
  aiEnabled?: boolean;
  aiProvider?: AiProviderId;
  aiModel?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  customAiApiKey?: string;
  customAiBaseUrl?: string;
  enableRegistration?: boolean;
  enableGuestAccess?: boolean;
  defaultUserRole?: UserRole;
  sessionTimeout?: number;
}

// Validation schemas
const smtpSettingsSchema = z.object({
  smtpHost: z.string().optional(),
  smtpPort: z.string().regex(/^\d+$/, "Port must be a number").optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpFromEmail: z.string().email("Invalid email address").or(z.literal("")),
  smtpFromName: z.string().optional(),
});
type SmtpSettingsData = z.infer<typeof smtpSettingsSchema>;

const registrationSettingsSchema = z.object({
  allowRegistration: z.boolean().optional(),
  requireAdminApproval: z.boolean().optional(),
});
type RegistrationSettingsData = z.infer<typeof registrationSettingsSchema>;

const aiSettingsSchema = z.object({
  aiEnabled: z.boolean().optional(),
  aiProvider: z.enum(AI_PROVIDER_IDS).optional(),
  aiModel: z.string().optional(),
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  geminiApiKey: z.string().optional(),
  customAiApiKey: z.string().optional(),
  customAiBaseUrl: z.string().optional(),
});
type AiSettingsData = z.infer<typeof aiSettingsSchema>;

const adminCopy = {
  title: "Administration",
  description:
    "Configure system settings, manage users, and adjust access controls.",
  tabs: {
    email: "Email Settings",
    registration: "Registration",
    ai: "AI Assistant",
    users: "Users",
    roles: "Roles",
    monitoring: "Monitoring",
  },
};

export default function AdminPage() {
  // Hash-based tab navigation
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "smtp",
    validTabs: ["smtp", "registration", "ai", "users", "roles", "monitoring"],
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
      onError: (error) => {
        toast({
          title: "Settings not saved",
          description: trpcErrorMessage(
            error,
            "Failed to save the system settings",
          ),
          variant: "destructive",
        });
      },
    });

  const sendTestEmailMutation = trpc.admin.sendTestEmail.useMutation({
    onSuccess: (result) => {
      toast({
        title: result.success ? "Test email sent" : "Test email failed",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
    },
    onError: (error) => {
      toast({
        title: "Test email failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const inviteUserMutation = trpc.admin.inviteUser.useMutation({
    onSuccess: (response) => {
      toast({
        title: "Success",
        description: `Invitation sent to ${String(response.data.email ?? "user")}`,
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
    onError: (error) => {
      toast({
        title: "Error",
        description: trpcErrorMessage(error, "Failed to update user"),
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
      void refetchUsers();
    },
  });

  const bulkUserOperationMutation = trpc.admin.bulkUserOperation.useMutation({
    onSuccess: (data) => {
      // A user it refused is reported by removeUser, which has the reason.
      if (data.results.every((r) => r.success)) {
        toast({
          title: "Success",
          description: `Operation completed successfully on ${data.results.length} users`,
        });
      }
      void refetchUsers();
    },
  });

  const resendInvitationMutation = trpc.admin.resendInvitation.useMutation({
    onSuccess: (response) => {
      toast({
        title: "Success",
        description: `Invitation sent to ${response.email ?? "user"}`,
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
  // Extract settings from the response wrapper
  const settings = (systemSettings?.data as unknown as SystemSettings) ?? {};

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
    // Ensure smtpPort is always a string
    updateSystemSettingsMutation.mutate({
      ...settings,
      ...validatedData,
      smtpPort: validatedData.smtpPort
        ? String(validatedData.smtpPort)
        : undefined,
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

  // UsersManagement awaits these and says what happened, so they have to wait
  // for the server and reject when it refuses. `mutate` does neither.
  async function handleInviteUser(data: {
    email: string;
    role: UserRole;
  }): Promise<void> {
    await inviteUserMutation.mutateAsync(data);
  }

  // The bulk operation answers 200 for a user it refused, with the reason in
  // `results`. One call per click, so its callbacks can't multiply.
  async function removeUser(userId: string): Promise<void> {
    const { results } = await bulkUserOperationMutation.mutateAsync({
      userIds: [userId],
      operation: "delete",
    });
    const refused = results.find((result) => !result.success);
    if (refused) {
      throw new Error(refused.error ?? "The server refused this operation");
    }
  }

  async function handleUpdateUserStatus(
    userId: string,
    status: UserStatus,
  ): Promise<void> {
    await toggleUserStatusMutation.mutateAsync({ id: userId, status });
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
    await toggleUserStatusMutation.mutateAsync({
      id: userId,
      status: UserStatus.ACTIVE,
    });
  }

  async function handleUpdateRole(
    roleId: number,
    permissions: {
      console: boolean;
      localServerAccess: boolean;
    },
  ): Promise<void> {
    updateRolePermissionsMutation.mutate({ roleId, permissions });
  }

  return (
    <PageShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{adminCopy.title}</h1>
          <p className="text-gray-500">{adminCopy.description}</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={changeTab} className="w-full">
        <TabsList>
          <Tab value="smtp" icon={Mail} label={adminCopy.tabs.email} />
          <Tab
            value="registration"
            icon={Users}
            label={adminCopy.tabs.registration}
          />
          <Tab value="ai" icon={Sparkles} label={adminCopy.tabs.ai} />
          <Tab value="users" icon={UserCog} label={adminCopy.tabs.users} />
          <Tab value="roles" icon={Shield} label={adminCopy.tabs.roles} />
          <Tab
            value="monitoring"
            icon={Activity}
            label={adminCopy.tabs.monitoring}
          />
        </TabsList>

        <TabsContent value="smtp">
          <SmtpSettings
            settings={settings}
            onSave={saveSmtpSettings}
            onSendTest={() => sendTestEmailMutation.mutate({})}
            isSendingTest={sendTestEmailMutation.isPending}
          />
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
            onDeleteUser={removeUser}
            onUpdateUserStatus={handleUpdateUserStatus}
            onUpdateUserRole={handleUpdateUserRole}
            onResendInvitation={handleResendInvitation}
            onApproveUser={handleApproveUser}
            onDenyUser={removeUser}
          />
        </TabsContent>

        <TabsContent value="roles">
          <RolesManagement
            roles={roles?.items ?? []}
            isLoading={isRolesLoading}
            onRefresh={async () => {
              await refetchRoles();
            }}
            onUpdateRole={handleUpdateRole}
          />
        </TabsContent>

        <TabsContent value="monitoring">
          <SystemHealth />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
