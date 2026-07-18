"use client";
import { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Settings,
  User,
  Save,
  Trash2,
  Palette,
  Key,
  Variable,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useHashTabNavigation } from "@/hooks/useHashTabNavigation";
import { Form } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Tabs, TabsContent, TabsList, Tab } from "@cronium/ui";
import { SettingsCard, FormFieldWrapper } from "@/components/dashboard";
import { Spinner } from "@cronium/ui";
import { toast } from "@cronium/ui";
import { ThemeToggle } from "@cronium/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@cronium/ui";
import ApiTokensManager from "@/components/dashboard/ApiTokensManager";
import { UserVariablesManager } from "@/components/dashboard/UserVariablesManager";

const copy = {
  title: "Account Settings",
  profileTab: "Profile",
  appearanceTab: "Appearance",
  apiTokensTab: "API Tokens",
  profileSettings: "Profile Settings",
  profileDescription: "Update your basic account information.",
  firstName: "First Name",
  lastName: "Last Name",
  emailAddress: "Email Address",
  changePassword: "Change Password",
  passwordDescription: "Update your password to keep your account secure.",
  currentPassword: "Current Password",
  newPassword: "New Password",
  minimumChars: "At least 8 characters",
  confirmPassword: "Confirm Password",
  deleteAccount: "Delete Account",
  saving: "Saving...",
  saveChanges: "Save Changes",
  appearance: "Appearance",
  appearanceDescription: "Customize how Cronium looks on your device.",
  themePreferences: "Theme Preferences",
} as const;

// User settings schema
const userSettingsSchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email(),
    currentPassword: z.string().optional(),
    newPassword: z
      .string()
      .optional()
      .refine((val) => !val || val.length >= 8, {
        message: copy.minimumChars,
      }),
    confirmPassword: z
      .string()
      .optional()
      .refine((val) => !val || val.length >= 8, {
        message: copy.minimumChars,
      }),
  })
  .refine(
    (data) => {
      if (data.newPassword && !data.currentPassword) {
        return false;
      }
      return true;
    },
    {
      message: "Current password is required when setting a new password",
      path: ["currentPassword"],
    },
  )
  .refine(
    (data) => {
      if (data.newPassword && data.newPassword !== data.confirmPassword) {
        return false;
      }
      return true;
    },
    {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    },
  );

type UserSettingsFormValues = z.infer<typeof userSettingsSchema>;

export default function SettingsPage() {
  const { user, isLoading: isLoadingAuth } = useAuth();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // tRPC mutations
  const updateProfileMutation = trpc.userAuth.updateProfile.useMutation({
    onSuccess: () => {
      // Reset password fields
      userSettingsForm.setValue("currentPassword", "");
      userSettingsForm.setValue("newPassword", "");
      userSettingsForm.setValue("confirmPassword", "");

      toast({
        title: "Profile Updated",
        description: "Your profile has been updated successfully.",
        variant: "success",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error.message ?? "Failed to save profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Hash-based tab navigation
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "profile",
    validTabs: ["profile", "appearance", "api-tokens", "variables"],
  });

  // User settings form
  const userSettingsForm = useForm<UserSettingsFormValues>({
    resolver: zodResolver(userSettingsSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (!user) {
      return;
    }

    userSettingsForm.reset(
      {
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        email: user.email ?? "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      },
      {
        keepDirtyValues: true, // don't clobber the user's current edits if data refetches mid-typing
      },
    );
  }, [
    user?.id,
    user?.firstName,
    user?.lastName,
    user?.email,
    userSettingsForm,
  ]);

  const onSaveUserSettings = async (data: UserSettingsFormValues) => {
    // Filter out empty password fields unless they're being updated
    const payload: {
      firstName?: string | undefined;
      lastName?: string | undefined;
      email: string;
      currentPassword?: string | undefined;
      newPassword?: string | undefined;
    } = {
      email: data.email,
    };

    if (data.firstName) {
      payload.firstName = data.firstName;
    }

    if (data.lastName) {
      payload.lastName = data.lastName;
    }

    if (data.newPassword) {
      payload.currentPassword = data.currentPassword;
      payload.newPassword = data.newPassword;
    }

    updateProfileMutation.mutate(payload);
  };

  // tRPC mutation for account deletion
  const deleteAccountMutation = trpc.userAuth.deleteAccount.useMutation({
    onSuccess: () => {
      toast({
        title: "Account Deleted",
        description: "Your account has been successfully deleted.",
        variant: "success",
      });
      // Redirect to logout
      window.location.href = "/api/auth/signout";
    },
    onError: (error) => {
      console.error("Error deleting account:", error);
      toast({
        title: "Error",
        description:
          error.message ?? "Failed to delete account. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
    },
  });

  const handleDeleteAccount = async () => {
    if (!user) return;
    setIsDeleting(true);
    deleteAccountMutation.mutate();
  };

  if (isLoadingAuth) {
    return (
      <div className="container mx-auto p-4">
        <div className="mb-6 flex items-center">
          <h1 className="text-2xl font-bold">{copy.title}</h1>
        </div>
        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" variant="primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center">
        <Settings className="mr-2 h-6 w-6" />
        <h1 className="text-2xl font-bold">{copy.title}</h1>
      </div>

      <Tabs value={activeTab} onValueChange={changeTab}>
        <div className="mb-6">
          <TabsList>
            <Tab value="profile" icon={User} label={copy.profileTab} />

            <Tab value="appearance" icon={Palette} label={copy.appearanceTab} />

            <Tab value="api-tokens" icon={Key} label={copy.apiTokensTab} />
            <Tab value="variables" icon={Variable} label="Variables" />
          </TabsList>
        </div>

        <TabsContent value="profile">
          <Form {...userSettingsForm}>
            <form
              onSubmit={userSettingsForm.handleSubmit(onSaveUserSettings)}
              className="space-y-6"
            >
              <SettingsCard
                title={copy.profileSettings}
                description={copy.profileDescription}
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormFieldWrapper
                    form={userSettingsForm}
                    name="firstName"
                    label={copy.firstName}
                    placeholder="First name"
                  />

                  <FormFieldWrapper
                    form={userSettingsForm}
                    name="lastName"
                    label={copy.lastName}
                    placeholder="Last name"
                  />
                </div>

                <FormFieldWrapper
                  form={userSettingsForm}
                  name="email"
                  label={copy.emailAddress}
                  type="email"
                  placeholder="Email address"
                />
              </SettingsCard>

              <SettingsCard
                title={copy.changePassword}
                description={copy.passwordDescription}
              >
                <FormFieldWrapper
                  form={userSettingsForm}
                  name="currentPassword"
                  label={copy.currentPassword}
                  type="password"
                  placeholder="Enter your current password"
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormFieldWrapper
                    form={userSettingsForm}
                    name="newPassword"
                    label={copy.newPassword}
                    type="password"
                    placeholder="Enter new password"
                    description={copy.minimumChars}
                  />

                  <FormFieldWrapper
                    form={userSettingsForm}
                    name="confirmPassword"
                    label={copy.confirmPassword}
                    type="password"
                    placeholder="Confirm new password"
                  />
                </div>
              </SettingsCard>

              <SettingsCard
                title=""
                footer={
                  <div className="flex w-full justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      className="text-destructive flex items-center"
                      onClick={() => setIsDeleteDialogOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {copy.deleteAccount}
                    </Button>

                    <Button
                      type="submit"
                      className="flex items-center"
                      disabled={updateProfileMutation.isPending}
                    >
                      {updateProfileMutation.isPending ? (
                        <>
                          <Spinner
                            className="mr-2 h-4 w-4"
                            size="lg"
                            variant="primary"
                          />
                          {copy.saving}
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          {copy.saveChanges}
                        </>
                      )}
                    </Button>
                  </div>
                }
              >
                <div />
              </SettingsCard>
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="appearance">
          <SettingsCard
            title={copy.appearance}
            description={copy.appearanceDescription}
          >
            <div className="space-y-4">
              <h3 className="text-lg font-medium">{copy.themePreferences}</h3>
              <ThemeToggle showLabel={true} />
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="api-tokens">
          <ApiTokensManager />
        </TabsContent>

        <TabsContent value="variables">
          <UserVariablesManager />
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              account and remove all your scripts, logs, and data from our
              servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={isDeleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? (
                <>
                  <Spinner size="lg" />
                  Deleting...
                </>
              ) : (
                "Delete Account"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
