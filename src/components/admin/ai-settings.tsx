"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { Sparkles, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsSection } from "./settings-section";

const aiSettingsSchema = z.object({
  aiEnabled: z.boolean().optional(),
  aiModel: z.string().min(1, "AI model selection is required"),
  openaiApiKey: z.string().min(1, "OpenAI API key is required"),
});

interface SystemSettings {
  aiEnabled?: boolean;
  aiModel?: string;
  openaiApiKey?: string;
}

interface AiSettingsProps {
  settings: SystemSettings;
  onSave: (data: z.infer<typeof aiSettingsSchema>) => Promise<void>;
}

export function AiSettings({ settings, onSave }: AiSettingsProps) {
  const t = useTranslations("Admin");
  const tCommon = useTranslations("Common");

  const form = useForm<z.infer<typeof aiSettingsSchema>>({
    resolver: zodResolver(aiSettingsSchema),
    defaultValues: {
      aiEnabled: settings.aiEnabled || false,
      aiModel: settings.aiModel || "gpt-4o",
      openaiApiKey: settings.openaiApiKey || "",
    },
  });

  // Update form when settings change
  React.useEffect(() => {
    form.reset({
      aiEnabled: settings.aiEnabled || false,
      aiModel: settings.aiModel || "gpt-4o",
      openaiApiKey: settings.openaiApiKey || "",
    });
  }, [settings, form]);

  return (
    <SettingsSection
      title={t("AiSettings.Title")}
      description={t("AiSettings.Description")}
      icon={Sparkles}
    >
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        <div className="flex items-center space-x-2">
          <Switch
            id="aiEnabled"
            checked={form.watch("aiEnabled") ?? false}
            onCheckedChange={(checked) => form.setValue("aiEnabled", checked)}
          />
          <Label htmlFor="aiEnabled">{t("AiSettings.EnableAi")}</Label>
        </div>

        {form.watch("aiEnabled") && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="aiModel">{t("AiSettings.Model")}</Label>
              <Select
                value={form.watch("aiModel")}
                onValueChange={(value) => form.setValue("aiModel", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select AI model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                  <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                  <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                </SelectContent>
              </Select>
              {form.formState.errors.aiModel && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.aiModel.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="openaiApiKey">{t("AiSettings.ApiKey")}</Label>
              <Input
                id="openaiApiKey"
                type="password"
                placeholder="sk-..."
                {...form.register("openaiApiKey")}
              />
              {form.formState.errors.openaiApiKey && (
                <p className="text-sm text-red-600">
                  {form.formState.errors.openaiApiKey.message}
                </p>
              )}
            </div>
          </div>
        )}

        <Button type="submit" className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          {tCommon("Save")}
        </Button>
      </form>
    </SettingsSection>
  );
}
