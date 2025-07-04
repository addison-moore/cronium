"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { UserPlus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "./settings-section";

const registrationSettingsSchema = z.object({
  allowRegistration: z.boolean().optional(),
  requireAdminApproval: z.boolean().optional(),
  inviteOnly: z.boolean().optional(),
});

interface SystemSettings {
  allowRegistration?: boolean;
  requireAdminApproval?: boolean;
  inviteOnly?: boolean;
}

interface RegistrationSettingsProps {
  settings: SystemSettings;
  onSave: (data: z.infer<typeof registrationSettingsSchema>) => Promise<void>;
}

export function RegistrationSettings({
  settings,
  onSave,
}: RegistrationSettingsProps) {
  const t = useTranslations("Admin");
  const tCommon = useTranslations("Common");

  const form = useForm<z.infer<typeof registrationSettingsSchema>>({
    resolver: zodResolver(registrationSettingsSchema),
    defaultValues: {
      allowRegistration: settings.allowRegistration ?? true,
      requireAdminApproval: settings.requireAdminApproval ?? false,
      inviteOnly: settings.inviteOnly ?? false,
    },
  });

  // Update form when settings change
  React.useEffect(() => {
    form.reset({
      allowRegistration: settings.allowRegistration ?? true,
      requireAdminApproval: settings.requireAdminApproval ?? false,
      inviteOnly: settings.inviteOnly ?? false,
    });
  }, [settings, form]);

  // Handle mutual exclusivity logic for registration settings
  const handleAllowRegistrationChange = (checked: boolean) => {
    form.setValue("allowRegistration", checked);
    if (checked) {
      // If "Allow public registration" is toggled on, "Invite-only registration" should be toggled off
      form.setValue("inviteOnly", false);
    }
  };

  const handleRequireAdminApprovalChange = (checked: boolean) => {
    form.setValue("requireAdminApproval", checked);
    if (checked && form.watch("inviteOnly")) {
      // If "Invite-only registration" is on and user toggles "Require admin approval" on,
      // "Invite-only registration" should toggle off, and "Allow public registration" should toggle on
      form.setValue("inviteOnly", false);
      form.setValue("allowRegistration", true);
    }
  };

  const handleInviteOnlyChange = (checked: boolean) => {
    form.setValue("inviteOnly", checked);
    if (checked) {
      // If "Invite-only registration" is toggled on,
      // "Allow public registration" and "Require admin approval" should be toggled off
      form.setValue("allowRegistration", false);
      form.setValue("requireAdminApproval", false);
    }
  };

  return (
    <SettingsSection
      title={t("RegistrationSettings.Title")}
      description={t("RegistrationSettings.Description")}
      icon={UserPlus}
    >
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="allowRegistration"
              checked={form.watch("allowRegistration") ?? false}
              onCheckedChange={handleAllowRegistrationChange}
            />
            <Label htmlFor="allowRegistration">
              {t("RegistrationSettings.AllowRegistration")}
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="requireAdminApproval"
              checked={form.watch("requireAdminApproval") ?? false}
              onCheckedChange={handleRequireAdminApprovalChange}
            />
            <Label htmlFor="requireAdminApproval">
              {t("RegistrationSettings.RequireAdminApproval")}
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="inviteOnly"
              checked={form.watch("inviteOnly") ?? false}
              onCheckedChange={handleInviteOnlyChange}
            />
            <Label htmlFor="inviteOnly">
              {t("RegistrationSettings.InviteOnly")}
            </Label>
          </div>
        </div>

        <Button type="submit" className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          {tCommon("Save")}
        </Button>
      </form>
    </SettingsSection>
  );
}
