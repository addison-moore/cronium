"use client";

import React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { Mail, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "./settings-section";

const smtpSettingsSchema = z.object({
  smtpHost: z.string().min(1, "SMTP host is required"),
  smtpPort: z.string().regex(/^\d+$/, "Port must be a number"),
  smtpUser: z.string().min(1, "SMTP user is required"),
  smtpPassword: z.string().min(1, "SMTP password is required"),
  smtpFromEmail: z.string().email("Invalid email address"),
  smtpFromName: z.string().min(1, "From name is required"),
  smtpEnabled: z.boolean().optional(),
});

interface SystemSettings {
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFromEmail?: string;
  smtpFromName?: string;
  smtpEnabled?: boolean;
}

interface SmtpSettingsProps {
  settings: SystemSettings;
  onSave: (data: z.infer<typeof smtpSettingsSchema>) => Promise<void>;
}

export function SmtpSettings({ settings, onSave }: SmtpSettingsProps) {
  const t = useTranslations("Admin");
  const tCommon = useTranslations("Common");

  const form = useForm<z.infer<typeof smtpSettingsSchema>>({
    resolver: zodResolver(smtpSettingsSchema),
    defaultValues: {
      smtpHost: settings.smtpHost ?? "",
      smtpPort: settings.smtpPort ?? "25",
      smtpUser: settings.smtpUser ?? "",
      smtpPassword: settings.smtpPassword ?? "",
      smtpFromEmail: settings.smtpFromEmail ?? "",
      smtpFromName: settings.smtpFromName ?? "",
      smtpEnabled: settings.smtpEnabled ?? false,
    },
  });

  // Update form when settings change
  React.useEffect(() => {
    if (settings.smtpHost) {
      form.reset({
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort ?? "25",
        smtpUser: settings.smtpUser ?? "",
        smtpPassword: settings.smtpPassword ?? "",
        smtpFromEmail: settings.smtpFromEmail ?? "",
        smtpFromName: settings.smtpFromName ?? "",
        smtpEnabled: settings.smtpEnabled ?? false,
      });
    }
  }, [settings, form]);

  return (
    <SettingsSection
      title={t("EmailSettings.Title")}
      description={t("EmailSettings.Description")}
      icon={Mail}
    >
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtpHost">{t("EmailSettings.SmtpHost")}</Label>
            <Input
              id="smtpHost"
              placeholder="smtp.gmail.com"
              aria-describedby={
                form.formState.errors.smtpHost ? "smtpHost-error" : undefined
              }
              {...form.register("smtpHost")}
            />
            {form.formState.errors.smtpHost && (
              <p id="smtpHost-error" className="text-sm text-red-600">
                {form.formState.errors.smtpHost.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtpPort">{t("EmailSettings.SmtpPort")}</Label>
            <Input
              id="smtpPort"
              placeholder="587"
              aria-describedby={
                form.formState.errors.smtpPort ? "smtpPort-error" : undefined
              }
              {...form.register("smtpPort")}
            />
            {form.formState.errors.smtpPort && (
              <p id="smtpPort-error" className="text-sm text-red-600">
                {form.formState.errors.smtpPort.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtpUser">{t("EmailSettings.SmtpUser")}</Label>
            <Input
              id="smtpUser"
              placeholder="your-email@gmail.com"
              aria-describedby={
                form.formState.errors.smtpUser ? "smtpUser-error" : undefined
              }
              {...form.register("smtpUser")}
            />
            {form.formState.errors.smtpUser && (
              <p id="smtpUser-error" className="text-sm text-red-600">
                {form.formState.errors.smtpUser.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtpPassword">
              {t("EmailSettings.SmtpPassword")}
            </Label>
            <Input
              id="smtpPassword"
              type="password"
              placeholder="your-app-password"
              aria-describedby={
                form.formState.errors.smtpPassword
                  ? "smtpPassword-error"
                  : undefined
              }
              {...form.register("smtpPassword")}
            />
            {form.formState.errors.smtpPassword && (
              <p id="smtpPassword-error" className="text-sm text-red-600">
                {form.formState.errors.smtpPassword.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtpFromEmail">
              {t("EmailSettings.FromEmail")}
            </Label>
            <Input
              id="smtpFromEmail"
              type="email"
              placeholder="noreply@yourcompany.com"
              aria-describedby={
                form.formState.errors.smtpFromEmail
                  ? "smtpFromEmail-error"
                  : undefined
              }
              {...form.register("smtpFromEmail")}
            />
            {form.formState.errors.smtpFromEmail && (
              <p id="smtpFromEmail-error" className="text-sm text-red-600">
                {form.formState.errors.smtpFromEmail.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtpFromName">{t("EmailSettings.FromName")}</Label>
            <Input
              id="smtpFromName"
              placeholder="Your Company"
              aria-describedby={
                form.formState.errors.smtpFromName
                  ? "smtpFromName-error"
                  : undefined
              }
              {...form.register("smtpFromName")}
            />
            {form.formState.errors.smtpFromName && (
              <p id="smtpFromName-error" className="text-sm text-red-600">
                {form.formState.errors.smtpFromName.message}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Controller
            name="smtpEnabled"
            control={form.control}
            render={({ field }) => (
              <Switch
                id="smtpEnabled"
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Label htmlFor="smtpEnabled">{t("EmailSettings.EnableEmail")}</Label>
        </div>

        <Button type="submit" className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          {tCommon("Save")}
        </Button>
      </form>
    </SettingsSection>
  );
}
