"use client";
import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, Save, Eye, EyeOff } from "lucide-react";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { SettingsSection } from "./settings-section";

const copy = {
  title: "Email Settings",
  description: "Configure SMTP details for transactional emails.",
  hostLabel: "SMTP Host",
  portLabel: "SMTP Port",
  userLabel: "SMTP Username",
  passwordLabel: "SMTP Password",
  fromEmailLabel: "From Email",
  fromNameLabel: "From Name",
  enableDescription:
    "Provide valid SMTP credentials to enable email notifications.",
  save: "Save",
} as const;

const smtpSettingsSchema = z.object({
  smtpHost: z.string().optional(),
  smtpPort: z.string().regex(/^\d+$/, "Port must be a number").optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpFromEmail: z.string().email("Invalid email address").or(z.literal("")),
  smtpFromName: z.string().optional(),
});

interface SystemSettings {
  smtpHost?: string;
  smtpPort?: string | number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFromEmail?: string;
  smtpFromName?: string;
}

interface SmtpSettingsProps {
  settings: SystemSettings;
  onSave: (data: z.infer<typeof smtpSettingsSchema>) => Promise<void>;
}

export function SmtpSettings({ settings, onSave }: SmtpSettingsProps) {
  const [showPassword, setShowPassword] = React.useState(false);

  const form = useForm<z.infer<typeof smtpSettingsSchema>>({
    resolver: zodResolver(smtpSettingsSchema),
    defaultValues: {
      smtpHost: settings.smtpHost ?? "",
      smtpPort: String(settings.smtpPort ?? "25"),
      smtpUser: settings.smtpUser ?? "",
      smtpPassword: settings.smtpPassword ?? "",
      smtpFromEmail: settings.smtpFromEmail ?? "",
      smtpFromName: settings.smtpFromName ?? "",
    },
  });

  // Update form when settings change
  React.useEffect(() => {
    form.reset({
      smtpHost: settings.smtpHost ?? "",
      smtpPort: String(settings.smtpPort ?? ""),
      smtpUser: settings.smtpUser ?? "",
      smtpPassword: settings.smtpPassword ?? "",
      smtpFromEmail: settings.smtpFromEmail ?? "",
      smtpFromName: settings.smtpFromName ?? "",
    });
  }, [settings, form]);

  return (
    <SettingsSection
      title={copy.title}
      description={copy.description}
      icon={Mail}
    >
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtpHost">{copy.hostLabel}</Label>
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
            <Label htmlFor="smtpPort">{copy.portLabel}</Label>
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
            <Label htmlFor="smtpUser">{copy.userLabel}</Label>
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
            <Label htmlFor="smtpPassword">{copy.passwordLabel}</Label>
            <div className="relative">
              <Input
                id="smtpPassword"
                type={showPassword ? "text" : "password"}
                placeholder="your-app-password"
                className="pr-10"
                aria-describedby={
                  form.formState.errors.smtpPassword
                    ? "smtpPassword-error"
                    : undefined
                }
                {...form.register("smtpPassword")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute top-0 right-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-gray-500" />
                ) : (
                  <Eye className="h-4 w-4 text-gray-500" />
                )}
              </Button>
            </div>
            {form.formState.errors.smtpPassword && (
              <p id="smtpPassword-error" className="text-sm text-red-600">
                {form.formState.errors.smtpPassword.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtpFromEmail">{copy.fromEmailLabel}</Label>
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
            <Label htmlFor="smtpFromName">{copy.fromNameLabel}</Label>
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

        <p className="text-muted-foreground text-sm">
          {copy.enableDescription}
        </p>

        <Button type="submit" className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          {copy.save}
        </Button>
      </form>
    </SettingsSection>
  );
}
