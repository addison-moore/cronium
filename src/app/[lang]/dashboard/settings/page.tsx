"use client";

import { useState, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { z } from "zod";
import {
  Settings,
  User,
  Save,
  Trash2,
  Palette,
  Key,
  Plug,
  Variable,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useHashTabNavigation } from "@/hooks/useHashTabNavigation";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, Tab } from "@/components/ui/tabs";
import { SettingsCard, FormFieldWrapper } from "@/components/dashboard";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/use-toast";
import { ThemeToggle } from "@/components/ui/theme-toggle";
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
import ApiTokensManager from "@/components/dashboard/ApiTokensManager";
import { ModularToolsManager } from "@/components/tools/modular-tools-manager";
import { UserVariablesManager } from "@/components/dashboard/UserVariablesManager";

// User settings schema
const userSettingsSchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).optional(),
    confirmPassword: z.string().optional(),
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

  const t = useTranslations("Settings");

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
    validTabs: [
      "profile",
      "appearance",
      "api-tokens",
      "integrations",
      "variables",
    ],
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
    if (user) {
      userSettingsForm.setValue("firstName", user.firstName ?? "");
      userSettingsForm.setValue("lastName", user.lastName ?? "");
      userSettingsForm.setValue("email", user.email ?? "");
    }
  }, [user, userSettingsForm]);

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
          <h1 className="text-2xl font-bold">{t("Title")}</h1>
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
        <h1 className="text-2xl font-bold">{t("Title")}</h1>
      </div>

      <Tabs value={activeTab} onValueChange={changeTab}>
        <div className="mb-6">
          <TabsList>
            <Tab value="profile" icon={User} label={t("Profile")} />

            <Tab value="appearance" icon={Palette} label={t("Appearance")} />

            <Tab value="api-tokens" icon={Key} label={t("APITokens.Title")} />
            <Tab value="integrations" icon={Plug} label="Tools" />
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
                title={t("ProfileSettings")}
                description={t("ProfileDescription")}
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormFieldWrapper
                    form={userSettingsForm}
                    name="firstName"
                    label={t("FirstName")}
                    placeholder="First name"
                  />

                  <FormFieldWrapper
                    form={userSettingsForm}
                    name="lastName"
                    label={t("LastName")}
                    placeholder="Last name"
                  />
                </div>

                <FormFieldWrapper
                  form={userSettingsForm}
                  name="email"
                  label={t("EmailAddress")}
                  type="email"
                  placeholder="Email address"
                />
              </SettingsCard>

              <SettingsCard
                title={t("ChangePassword")}
                description={t("PasswordDescription")}
              >
                <FormFieldWrapper
                  form={userSettingsForm}
                  name="currentPassword"
                  label={t("CurrentPassword")}
                  type="password"
                  placeholder="Enter your current password"
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormFieldWrapper
                    form={userSettingsForm}
                    name="newPassword"
                    label={t("NewPassword")}
                    type="password"
                    placeholder="Enter new password"
                    description={t("MinimumChars")}
                  />

                  <FormFieldWrapper
                    form={userSettingsForm}
                    name="confirmPassword"
                    label={t("ConfirmPassword")}
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
                      className="flex items-center text-red-500"
                      onClick={() => setIsDeleteDialogOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("DeleteAccount")}
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
                          {t("Saving")}
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          {t("SaveChanges")}
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
            title={t("Appearance")}
            description={t("AppearanceDescription")}
          >
            <div className="space-y-4">
              <h3 className="text-lg font-medium">{t("ThemePreferences")}</h3>
              <ThemeToggle showLabel={true} />
            </div>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="api-tokens">
          <ApiTokensManager />
        </TabsContent>

        <TabsContent value="integrations">
          <ModularToolsManager />
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
