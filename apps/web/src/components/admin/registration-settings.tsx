"use client";

import React from "react";
import { useForm, Controller } from "react-hook-form";
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
});

interface SystemSettings {
  allowRegistration?: boolean;
  requireAdminApproval?: boolean;
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
      allowRegistration: settings.allowRegistration ?? false,
      requireAdminApproval: settings.requireAdminApproval ?? true,
    },
  });

  // Update form when settings change
  React.useEffect(() => {
    form.reset({
      allowRegistration: settings.allowRegistration ?? false,
      requireAdminApproval: settings.requireAdminApproval ?? true,
    });
  }, [settings, form]);

  return (
    <SettingsSection
      title={t("RegistrationSettings.Title")}
      description={t("RegistrationSettings.Description")}
      icon={UserPlus}
    >
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Controller
              name="allowRegistration"
              control={form.control}
              render={({ field }) => (
                <Switch
                  id="allowRegistration"
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="allowRegistration">
              {t("RegistrationSettings.AllowRegistration")}
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Controller
              name="requireAdminApproval"
              control={form.control}
              render={({ field }) => (
                <Switch
                  id="requireAdminApproval"
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="requireAdminApproval">
              {t("RegistrationSettings.RequireAdminApproval")}
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
