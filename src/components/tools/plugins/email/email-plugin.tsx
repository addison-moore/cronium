"use client";

import React from "react";
import { z } from "zod";
import { EmailIcon } from "./email-icon";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Edit, Trash2, Eye, EyeOff, Shield } from "lucide-react";
import { TemplateForm } from "../../template-form";
import { useAuth } from "@/hooks/useAuth";
import {
  type ToolPlugin,
  type CredentialFormProps,
  type CredentialDisplayProps,
  type TemplateManagerProps,
} from "../../types/tool-plugin";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/use-toast";

// Email credentials schema - unchanged
const emailSchema = z.object({
  name: z.string().min(1, "Name is required"),
  host: z.string().min(1, "SMTP host is required"),
  port: z.number().min(1, "Port is required"),
  user: z.string().min(1, "SMTP user is required"),
  password: z.string().min(1, "Password is required"),
  fromEmail: z.string().email("Valid email address is required"),
  fromName: z.string().min(1, "From name is required"),
});

// Email credential form component - unchanged UI
function EmailCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm({
    resolver: zodResolver(emailSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? JSON.parse(tool.credentials)
            : tool.credentials),
        }
      : {
          name: "",
          host: "",
          port: "",
          user: "",
          password: "",
          fromEmail: "",
          fromName: "",
        },
  });

  const handleSubmit = async (data: any) => {
    const { name, ...credentials } = data;
    await onSubmit({ name, credentials });
    form.reset();
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">Configuration Name</Label>
        <Input
          id="name"
          placeholder="My Email Server"
          {...form.register("name")}
        />
      </div>
      <div>
        <Label htmlFor="host">SMTP Host</Label>
        <Input
          id="host"
          placeholder="smtp.gmail.com"
          {...form.register("host")}
        />
      </div>
      <div>
        <Label htmlFor="port">Port</Label>
        <Input
          id="port"
          placeholder=""
          {...form.register("port", { valueAsNumber: true })}
        />
      </div>
      <div>
        <Label htmlFor="user">SMTP User</Label>
        <Input
          id="user"
          placeholder="your-email@gmail.com"
          {...form.register("user")}
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          placeholder="Your email password or app password"
          {...form.register("password")}
        />
      </div>
      <div>
        <Label htmlFor="fromEmail">From Email</Label>
        <Input
          id="fromEmail"
          type="email"
          placeholder="noreply@yourcompany.com"
          {...form.register("fromEmail")}
        />
      </div>
      <div>
        <Label htmlFor="fromName">From Name</Label>
        <Input
          id="fromName"
          placeholder="Your Company Name"
          {...form.register("fromName")}
        />
      </div>
      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{tool ? "Update" : "Create"}</Button>
      </div>
    </form>
  );
}

// Email credential display component - unchanged UI
function EmailCredentialDisplay({
  tools,
  onEdit,
  onDelete,
}: CredentialDisplayProps) {
  const [showPasswords, setShowPasswords] = React.useState<
    Record<number, boolean>
  >({});

  const togglePasswordVisibility = (toolId: number) => {
    setShowPasswords((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  return (
    <div className="space-y-3">
      {tools.map((tool) => {
        const credentials =
          typeof tool.credentials === "string"
            ? JSON.parse(tool.credentials)
            : (tool.credentials as Record<string, any>);
        const isPasswordVisible = showPasswords[tool.id];

        return (
          <div
            key={tool.id}
            className="border-border hover:bg-muted/50 flex items-center justify-between rounded-lg border p-4"
          >
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-3">
                <h4 className="font-medium">{tool.name}</h4>
                <Badge variant={tool.isActive ? "default" : "secondary"}>
                  {tool.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="text-muted-foreground grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Host:</span> {credentials.host}
                </div>
                <div>
                  <span className="font-medium">Port:</span> {credentials.port}
                </div>
                <div>
                  <span className="font-medium">User:</span> {credentials.user}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Password:</span>
                  <span>
                    {isPasswordVisible ? credentials.password : "••••••••"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => togglePasswordVisibility(tool.id)}
                  >
                    {isPasswordVisible ? (
                      <EyeOff size={14} />
                    ) : (
                      <Eye size={14} />
                    )}
                  </Button>
                </div>
                <div>
                  <span className="font-medium">From Email:</span>{" "}
                  {credentials.fromEmail}
                </div>
                <div>
                  <span className="font-medium">From Name:</span>{" "}
                  {credentials.fromName}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onEdit(tool)}>
                <Edit size={16} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(tool.id)}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Email template manager component - migrated to use tRPC
function EmailTemplateManagerTrpc({ toolType }: TemplateManagerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [editingTemplate, setEditingTemplate] = React.useState<any>(null);

  // tRPC queries and mutations
  const {
    data: templatesData,
    isLoading,
    refetch: refetchTemplates,
  } = trpc.integrations.templates.getAll.useQuery({
    type: toolType.toUpperCase() as any,
    includeSystem: true,
    includeUser: true,
  });

  const createTemplateMutation = trpc.integrations.templates.create.useMutation(
    {
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Template created successfully",
        });
        refetchTemplates();
        setShowAddForm(false);
        setEditingTemplate(null);
      },
    },
  );

  const updateTemplateMutation = trpc.integrations.templates.update.useMutation(
    {
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Template updated successfully",
        });
        refetchTemplates();
        setShowAddForm(false);
        setEditingTemplate(null);
      },
    },
  );

  const deleteTemplateMutation = trpc.integrations.templates.delete.useMutation(
    {
      onSuccess: () => {
        toast({
          title: "Success",
          description: "Template deleted successfully",
        });
        refetchTemplates();
      },
    },
  );

  const templates = templatesData?.templates || [];

  const handleSaveTemplate = async (data: any) => {
    try {
      const templateData = {
        name: data.name,
        type: toolType.toUpperCase() as any,
        content: data.content,
        subject: data.subject,
        description: data.description || "",
        variables: data.variables || [],
        isSystemTemplate: false,
        tags: data.tags || [],
      };

      if (editingTemplate) {
        await updateTemplateMutation.mutateAsync({
          id: editingTemplate.id,
          ...templateData,
        });
      } else {
        await createTemplateMutation.mutateAsync(templateData);
      }
    } catch (error) {
      // Error handled by mutation callbacks
      console.error("Error saving template:", error);
    }
  };

  const handleEditTemplate = (template: any) => {
    setEditingTemplate(template);
    setShowAddForm(true);
  };

  const handleCancelEdit = () => {
    setEditingTemplate(null);
    setShowAddForm(false);
  };

  const handleDeleteTemplate = async (templateId: number) => {
    if (templateId < 0) return; // Can't delete built-in templates

    try {
      await deleteTemplateMutation.mutateAsync({ id: templateId });
    } catch (error) {
      // Error handled by mutation callbacks
      console.error("Error deleting template:", error);
    }
  };

  if (isLoading) {
    return <div className="py-8 text-center">Loading templates...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Email Templates</h3>
        <Button onClick={() => setShowAddForm(true)}>Add Template</Button>
      </div>

      {showAddForm && (
        <div className="border-border bg-muted/50 rounded-lg border p-4">
          <h4 className="mb-4 font-medium">
            {editingTemplate ? "Edit Template" : "Create New Template"}
          </h4>
          <TemplateForm
            toolType="EMAIL"
            template={editingTemplate}
            onSubmit={handleSaveTemplate}
            onCancel={handleCancelEdit}
            showSubjectField={true}
          />
        </div>
      )}

      <div className="space-y-3">
        {templates.map((template) => (
          <div
            key={template.id}
            className="border-border hover:bg-muted/50 rounded-lg border"
          >
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem
                value={`template-${template.id}`}
                className="border-none"
              >
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <AccordionTrigger className="p-0 hover:no-underline">
                      <div className="flex items-center gap-3">
                        <h4 className="font-medium">{template.name}</h4>
                        <Badge
                          variant={
                            template.isSystemTemplate ? "outline" : "default"
                          }
                        >
                          {template.isSystemTemplate ? "System" : "Custom"}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                  </div>
                  <div className="flex items-center gap-2">
                    {!template.isSystemTemplate && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditTemplate(template)}
                        >
                          <Edit size={16} />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteTemplate(template.id)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <AccordionContent className="px-4 pb-4">
                  <div className="grid gap-3 text-sm">
                    <div>
                      <span className="font-medium">Subject:</span>
                      <div className="bg-muted mt-1 rounded border p-2 text-xs">
                        {template.subject || "No subject set"}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium">Content:</span>
                      <div className="bg-muted mt-1 rounded border p-3 font-mono text-xs whitespace-pre-wrap">
                        {template.content}
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="text-muted-foreground py-8 text-center">
          <p>No email templates configured yet.</p>
          <p className="text-sm">
            Templates will help you create consistent email notifications.
          </p>
        </div>
      )}
    </div>
  );
}

// Email plugin definition with tRPC integration
export const EmailPluginTrpc: ToolPlugin = {
  id: "email",
  name: "Email",
  description: "Send email notifications via SMTP",
  icon: EmailIcon,
  category: "Communication",

  schema: emailSchema,
  defaultValues: {
    name: "",
    host: "",
    port: "",
    user: "",
    password: "",
    fromEmail: "",
    fromName: "",
  },

  CredentialForm: EmailCredentialForm,
  CredentialDisplay: EmailCredentialDisplay,
  TemplateManager: EmailTemplateManagerTrpc,

  async validate(
    credentials: Record<string, any>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = emailSchema.safeParse(credentials);
    // With exactOptionalPropertyTypes: true, we need to handle undefined differently
    if (result.success) {
      return { isValid: true };
    } else {
      // When error message exists, return it as a non-optional property
      const errorMessage = result.error.issues[0]?.message;
      if (errorMessage) {
        return {
          isValid: false,
          error: errorMessage,
        };
      } else {
        // When no error message, don't include the error property at all
        return {
          isValid: false,
        };
      }
    }
  },

  async send(
    credentials: Record<string, any>,
    data: any,
    trpcClient?: any,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const { recipients, subject, message } = data;

      if (!recipients || !subject || !message) {
        return {
          success: false,
          message:
            "Missing required email fields: recipients, subject, or message",
        };
      }

      if (!trpcClient) {
        // Fallback to original REST API if tRPC client not provided
        const response = await fetch("/api/tools/email/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            toolId: credentials.id,
            recipients: recipients,
            subject: subject,
            message: message,
          }),
        });

        const result = await response.json();

        return {
          success: response.ok && result.success,
          message:
            result.message ||
            (response.ok ? "Email sent successfully" : "Failed to send email"),
        };
      }

      const result = await trpcClient.integrations.email.send.mutate({
        toolId: credentials.id,
        recipients: recipients,
        subject: subject,
        message: message,
      });

      return {
        success: result.success,
        message: result.message || "Email sent successfully",
      };
    } catch (error) {
      console.error("Email send error:", error);
      return {
        success: false,
        message: "Failed to send email due to network error",
      };
    }
  },

  // New method for testing email functionality using tRPC
  async test(credentials: any, testType = "connection", trpcClient?: any) {
    try {
      if (!trpcClient) {
        return {
          success: false,
          message: "tRPC client not available for testing",
        };
      }

      const result = await trpcClient.integrations.testMessage.mutate({
        toolId: credentials.id,
        testType,
        message:
          testType === "send_test_message"
            ? "Test email from Cronium"
            : undefined,
        recipient:
          testType === "send_test_message" ? "test@example.com" : undefined,
      });

      return {
        success: result.success,
        message: result.message,
        details: result.details,
      };
    } catch (error) {
      console.error("Email test error:", error);
      return {
        success: false,
        message: "Failed to test email connection",
      };
    }
  },
};
