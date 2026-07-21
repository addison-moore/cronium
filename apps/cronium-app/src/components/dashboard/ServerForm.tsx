"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Server,
  Key,
  Globe,
  User,
  Hash,
  Save,
  AlertTriangle,
  Lock,
} from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Textarea } from "@cronium/ui";
import { Checkbox } from "@cronium/ui";
import { Alert, AlertDescription, AlertTitle } from "@cronium/ui";
import { Spinner } from "@cronium/ui";
import { toast } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { type UpdateServerInput } from "@shared/schemas/servers";
import { z } from "zod";
import { AuthType } from "@/lib/validations/server";
import { trpc } from "@/lib/trpc";

// Create a form schema that matches the update schema structure
const serverFormSchema = z
  .object({
    name: z.string().min(1, "Server name is required").max(100),
    address: z.string().min(1, "Server address is required").max(255),
    authType: z.nativeEnum(AuthType),
    existingAuthType: z.nativeEnum(AuthType).optional(),
    sshKey: z.string().optional(),
    password: z.string().optional(),
    username: z.string().min(1, "Username is required").max(50),
    port: z.number().int().min(1).max(65535),
    description: z.string().max(500).optional(),
    tags: z.array(z.string()),
    shared: z.boolean(),
    maxConcurrentJobs: z.number().int().min(1).max(100),
  })
  .refine(
    (data) => {
      if (data.authType === AuthType.SSH_KEY) {
        return (
          (data.sshKey?.length ?? 0) > 0 ||
          data.existingAuthType === AuthType.SSH_KEY
        );
      } else if (data.authType === AuthType.PASSWORD) {
        return (
          (data.password?.length ?? 0) > 0 ||
          data.existingAuthType === AuthType.PASSWORD
        );
      }
      return false;
    },
    {
      message: "Authentication credentials are required",
      path: ["authType"],
    },
  );

// Create form type from the schema
type ServerFormInput = z.infer<typeof serverFormSchema>;

interface ServerFormProps {
  initialServer?: Partial<UpdateServerInput> & {
    hasPrivateKey?: boolean;
    hasPassword?: boolean;
  };
  isEditing: boolean;
  onSuccess: (serverId?: number) => void;
}

export default function ServerForm({
  initialServer,
  isEditing,
  onSuccess,
}: ServerFormProps) {
  const [sshKeyWarning, setSshKeyWarning] = useState<string | null>(null);

  // Determine initial auth type based on existing server data
  const determineAuthType = (): AuthType => {
    if (initialServer) {
      // If editing, check which auth method is currently used
      if (initialServer.hasPrivateKey) {
        return AuthType.SSH_KEY;
      } else if (initialServer.hasPassword) {
        return AuthType.PASSWORD;
      }
    }
    return AuthType.SSH_KEY; // Default to SSH key for new servers
  };

  // Default values for the form
  const defaultValues: ServerFormInput = {
    name: "",
    address: "",
    authType: AuthType.SSH_KEY,
    existingAuthType: undefined,
    sshKey: "",
    password: "",
    username: "root",
    port: 22,
    description: "",
    tags: [],
    shared: false,
    maxConcurrentJobs: 5,
  };

  // Initialize the form with the provided server data or defaults
  const form = useForm<ServerFormInput>({
    resolver: zodResolver(serverFormSchema),
    defaultValues: initialServer
      ? {
          name: initialServer.name ?? "",
          address: initialServer.address ?? "",
          authType: determineAuthType(),
          existingAuthType: determineAuthType(),
          sshKey: "", // For security, don't populate auth fields when editing
          password: "", // For security, don't populate auth fields when editing
          username: initialServer.username ?? "root",
          port: initialServer.port ? Number(initialServer.port) : 22,
          description: initialServer.description ?? "",
          tags: initialServer.tags ?? [],
          shared: initialServer.shared ?? false,
          maxConcurrentJobs: initialServer.maxConcurrentJobs ?? 5,
        }
      : defaultValues,
  });

  const authType = form.watch("authType");

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
        const sshKeyValue = value.sshKey;
        if (
          sshKeyValue &&
          typeof sshKeyValue === "string" &&
          value.authType === AuthType.SSH_KEY
        ) {
          const warning = validateSshKey(sshKeyValue);
          setSshKeyWarning(warning);
        } else {
          setSshKeyWarning(null);
        }
      }
    });

    return () => {
      if (subscription && typeof subscription.unsubscribe === "function") {
        subscription.unsubscribe();
      }
    };
  }, [form]);

  // Form submission handler
  const onSubmit = async (data: ServerFormInput) => {
    // Build request payload
    const payload = {
      ...data,
    };

    // Clean up unused auth fields based on authType
    if (data.authType === AuthType.SSH_KEY) {
      delete payload.password;
      // When editing, only include SSH key if it's provided (changed)
      if (isEditing && !data.sshKey) {
        delete payload.sshKey;
      }
    } else if (data.authType === AuthType.PASSWORD) {
      delete payload.sshKey;
      // When editing, only include password if it's provided (changed)
      if (isEditing && !data.password) {
        delete payload.password;
      }
    }

    // Remove authType from payload as it's not stored in DB
    const {
      authType,
      existingAuthType: _existingAuthType,
      ...serverPayload
    } = payload;
    void authType;
    void _existingAuthType;

    try {
      if (isEditing) {
        if (!initialServer?.id) {
          toast({
            title: "Error",
            description: "Server ID is required for updating",
            variant: "destructive",
          });
          return;
        }
        await updateServerMutation.mutateAsync({
          id: initialServer.id,
          ...serverPayload,
        });
      } else {
        // Ensure auth credentials are provided for new servers
        if (data.authType === AuthType.SSH_KEY && !serverPayload.sshKey) {
          toast({
            title: "Error",
            description: "SSH key is required when creating a new server",
            variant: "destructive",
          });
          return;
        } else if (
          data.authType === AuthType.PASSWORD &&
          !serverPayload.password
        ) {
          toast({
            title: "Error",
            description: "Password is required when creating a new server",
            variant: "destructive",
          });
          return;
        }
        await createServerMutation.mutateAsync(serverPayload);
      }
    } catch (error) {
      console.error(
        "Error saving server:",
        error instanceof Error ? error.message : "Unknown error",
      );
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "An error occurred while saving the server",
        variant: "destructive",
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-4">
          <FormField<ServerFormInput>
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Server Name</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Server className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                    <Input
                      className="pl-8"
                      placeholder="Production Server"
                      name={field.name}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      value={(field.value as string) ?? ""}
                      ref={field.ref}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField<ServerFormInput>
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Server Address</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Globe className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                    <Input
                      className="pl-8"
                      placeholder="example.com or 192.168.1.100"
                      name={field.name}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      value={(field.value as string) ?? ""}
                      ref={field.ref}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField<ServerFormInput>
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SSH Username</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <User className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                      <Input
                        className="pl-8"
                        placeholder="root"
                        name={field.name}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        value={(field.value as string) ?? ""}
                        ref={field.ref}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField<ServerFormInput>
              control={form.control}
              name="port"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SSH Port</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Hash className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                      <Input
                        className="pl-8"
                        type="number"
                        min={1}
                        max={65535}
                        placeholder="22"
                        name={field.name}
                        onBlur={field.onBlur}
                        value={(field.value as number) ?? 22}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value) || 22)
                        }
                        ref={field.ref}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField<ServerFormInput>
            control={form.control}
            name="authType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Authentication Method</FormLabel>
                <Select
                  value={(field.value as string) ?? "SSH_KEY"}
                  onValueChange={(value) => {
                    field.onChange(value);
                    // Clear the other auth field when switching
                    if (value === "SSH_KEY") {
                      form.setValue("password", "");
                    } else {
                      form.setValue("sshKey", "");
                    }
                  }}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select authentication method" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={AuthType.SSH_KEY}>
                      <div className="flex items-center">
                        <Key className="mr-2 h-4 w-4" />
                        SSH Key
                      </div>
                    </SelectItem>
                    <SelectItem value={AuthType.PASSWORD}>
                      <div className="flex items-center">
                        <Lock className="mr-2 h-4 w-4" />
                        Password
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {authType === AuthType.SSH_KEY && (
            <FormField<ServerFormInput>
              control={form.control}
              name="sshKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {isEditing
                      ? "SSH Private Key (Leave empty to keep the existing SSH key)"
                      : "SSH Private Key"}
                  </FormLabel>

                  {sshKeyWarning && (
                    <Alert className="border-warning/40 bg-warning/10 mb-2">
                      <AlertTriangle className="text-warning-text h-4 w-4" />
                      <AlertTitle className="text-warning-text">
                        SSH Key Format Warning
                      </AlertTitle>
                      <AlertDescription className="text-warning-text">
                        {sshKeyWarning}
                      </AlertDescription>
                    </Alert>
                  )}

                  <FormControl>
                    <div className="relative">
                      <Key className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                      <Textarea
                        className={`min-h-[180px] pl-8 font-mono ${sshKeyWarning ? "border-warning" : ""}`}
                        placeholder={`-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAxyz...
...
-----END RSA PRIVATE KEY-----`}
                        name={field.name}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        value={(field.value as string) ?? ""}
                        ref={field.ref}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {authType === AuthType.PASSWORD && (
            <FormField<ServerFormInput>
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {isEditing
                      ? "Password (Leave empty to keep existing)"
                      : "Password"}
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Lock className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
                      <Input
                        className="pl-8"
                        type="password"
                        placeholder={isEditing ? "••••••••" : "Enter password"}
                        name={field.name}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        value={(field.value as string) ?? ""}
                        ref={field.ref}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField<ServerFormInput>
            control={form.control}
            name="shared"
            render={({ field }) => (
              <FormItem className="border-border flex flex-row items-start space-y-0 space-x-3 rounded-md border p-4">
                <FormControl>
                  <Checkbox
                    checked={(field.value as boolean) ?? false}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Shared Server</FormLabel>
                  <p className="text-muted-foreground text-sm">
                    Allow other users to access this server for their events and
                    workflows
                  </p>
                </div>
              </FormItem>
            )}
          />
        </div>

        <div className="bg-info/10 rounded-md p-3">
          <p className="text-info-text text-sm">
            <Lock className="mr-1 inline h-3.5 w-3.5" />
            <strong>Security:</strong> Your SSH key is encrypted on your device
            and securely stored.
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
                {isEditing ? "Updating..." : "Creating..."}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {isEditing ? "Update Server" : "Save Server"}
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
