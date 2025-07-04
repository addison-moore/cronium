"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import {
  Server,
  Key,
  Globe,
  User,
  Hash,
  Save,
  AlertTriangle,
} from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  serverFormSchema,
  type UpdateServerFormValues,
} from "@/lib/validations/server";
import { Spinner } from "../ui/spinner";
import { trpc } from "@/lib/trpc";
import { toast } from "@/components/ui/use-toast";

interface ServerFormProps {
  initialServer?: any;
  isEditing: boolean;
  onSuccess: (serverId?: number) => void;
  lang?: string;
}

export default function ServerForm({
  initialServer,
  isEditing,
  onSuccess,
}: ServerFormProps) {
  const t = useTranslations("Servers.Form");
  const [sshKeyWarning, setSshKeyWarning] = useState<string | null>(null);

  // Default values for the form
  const defaultValues: Partial<UpdateServerFormValues> = {
    name: "",
    address: "",
    sshKey: "",
    username: "root",
    port: 22,
    shared: false,
  };

  // Initialize the form with the provided server data or defaults
  const form = useForm<UpdateServerFormValues>({
    resolver: zodResolver(serverFormSchema),
    defaultValues: initialServer
      ? {
          name: initialServer.name,
          address: initialServer.address,
          sshKey: "", // For security, don't populate the SSH key field when editing
          username: initialServer.username || "root",
          port: initialServer.port || 22,
          shared: initialServer.shared || false,
        }
      : defaultValues,
  });

  // tRPC mutations
  const createServerMutation = trpc.servers.create.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Server Created",
        description: `${data.name} has been created successfully.`,
      });
      onSuccess(data.id);
    },
  });

  const updateServerMutation = trpc.servers.update.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Server Updated",
        description: `${data.name} has been updated successfully.`,
      });
      onSuccess(data.id);
    },
  });

  const testConnectionMutation = trpc.servers.testConnection.useMutation();

  const isSubmitting =
    createServerMutation.isPending || updateServerMutation.isPending;

  // Basic validation for SSH key format
  const validateSshKey = (value: string): string | null => {
    if (!value) return null; // Empty is handled by schema validation

    // Check for begin/end markers
    const hasBeginMarker = value.includes("BEGIN");
    const hasEndMarker = value.includes("END");

    if (!hasBeginMarker && !hasEndMarker) {
      return "Your SSH key is missing both BEGIN and END markers";
    } else if (!hasBeginMarker) {
      return "Your SSH key is missing the BEGIN marker";
    } else if (!hasEndMarker) {
      return "Your SSH key is missing the END marker";
    }

    // Check for newlines in longer keys
    if (value.length > 100 && !value.includes("\n")) {
      return "Your SSH key appears to be missing line breaks";
    }

    return null;
  };

  // Watch SSH key changes to provide real-time feedback
  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (name === "sshKey" || name === undefined) {
        const sshKeyValue = value.sshKey as string;
        if (sshKeyValue) {
          const warning = validateSshKey(sshKeyValue);
          setSshKeyWarning(warning);
        } else {
          setSshKeyWarning(null);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [form]);

  // Form submission handler
  const onSubmit = async (data: UpdateServerFormValues) => {
    // Build request payload
    const payload = {
      ...data,
    };

    // When editing, only include SSH key if it's provided (changed)
    if (isEditing && !data.sshKey) {
      delete payload.sshKey;
    }

    try {
      if (isEditing) {
        await updateServerMutation.mutateAsync({
          id: initialServer.id,
          ...payload,
        });
      } else {
        if (!payload.sshKey) {
          toast({
            title: "Error",
            description: "SSH key is required when creating a new server",
            variant: "destructive",
          });
          return;
        }
        await createServerMutation.mutateAsync({
          ...payload,
          sshKey: payload.sshKey,
        });
      }
    } catch (error) {
      console.error("Error saving server:", error);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("ServerName")}</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Server className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                    <Input
                      className="pl-8"
                      placeholder={t("ServerNamePlaceholder")}
                      {...field}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("ServerAddress")}</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Globe className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                    <Input
                      className="pl-8"
                      placeholder={t("ServerAddressPlaceholder")}
                      {...field}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Username")}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <User className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                      <Input
                        className="pl-8"
                        placeholder={t("UsernamePlaceholder")}
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="port"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Port")}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Hash className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                      <Input
                        className="pl-8"
                        type="number"
                        min={1}
                        max={65535}
                        placeholder={t("PortPlaceholder")}
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="sshKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {isEditing
                    ? t("SSHKey") + " (" + t("KeepExistingKey") + ")"
                    : t("SSHKey")}
                </FormLabel>

                {sshKeyWarning && (
                  <Alert className="mb-2 border-amber-200 bg-amber-50">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-amber-800">
                      SSH Key Format Warning
                    </AlertTitle>
                    <AlertDescription className="text-amber-700">
                      {sshKeyWarning}
                    </AlertDescription>
                  </Alert>
                )}

                <FormControl>
                  <div className="relative">
                    <Key className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                    <Textarea
                      className={`min-h-[180px] pl-8 font-mono ${sshKeyWarning ? "border-amber-500" : ""}`}
                      placeholder={`-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAxyz...
...
-----END RSA PRIVATE KEY-----`}
                      {...field}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="shared"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-y-0 space-x-3 rounded-md border p-4">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>{t("SharedServer")}</FormLabel>
                  <p className="text-muted-foreground text-sm">
                    {t("SharedServerDescription")}
                  </p>
                </div>
              </FormItem>
            )}
          />
        </div>

        <div className="rounded-md bg-blue-50 p-3 dark:bg-blue-950">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>🔒 {t("Security")}:</strong> {t("SecurityNote")}
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center"
          >
            {isSubmitting ? (
              <>
                <Spinner size="lg" />
                {isEditing ? t("Updating") : t("Creating")}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {isEditing ? t("UpdateServer") : t("SaveButton")}
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
