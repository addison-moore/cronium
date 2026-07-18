"use client";

import React from "react";
import { z } from "zod";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Input,
  Label,
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { Edit, Trash2, AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  type ToolPlugin,
  type CredentialFormProps,
  type CredentialDisplayProps,
} from "../../types/tool-plugin";
import { ToolHealthBadge } from "@/tools/ToolHealthIndicator";
import { TestConnectionButton } from "@/tools/components/TestConnectionButton";
import { MongoDbIcon } from "./mongodb-icon";
import { mongoActions } from "./actions";
import {
  mongoCredentialsSchema,
  MONGO_SCHEMES,
  MONGO_TLS_MODES,
  DEFAULT_MONGO_PORT,
  type MongoCredentials,
  type MongoScheme,
} from "./schemas";

// Dedicated form schema (no z.coerce/defaults) so the react-hook-form resolver
// has matching input/output types under exactOptionalPropertyTypes. The `port`
// field is converted to a number via register's setValueAs; defaults are
// supplied through useForm's defaultValues. The server validates the stricter
// mongoCredentialsSchema on save.
const mongoFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  scheme: z.enum(MONGO_SCHEMES),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive().max(65535).optional(),
  database: z.string().min(1, "Database is required"),
  user: z.string().optional(),
  password: z.string().optional(),
  authSource: z.string().optional(),
  tls: z.enum(MONGO_TLS_MODES),
});
type MongoFormData = z.infer<typeof mongoFormSchema>;

const SCHEME_LABELS: Record<MongoScheme, string> = {
  mongodb: "Standard (mongodb://)",
  "mongodb+srv": "DNS seedlist / Atlas (mongodb+srv://)",
};

function MongoCredentialForm({
  tool,
  onSubmit,
  onCancel,
}: CredentialFormProps) {
  const form = useForm<MongoFormData>({
    resolver: zodResolver(mongoFormSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as MongoCredentials)
            : (tool.credentials as MongoCredentials)),
        }
      : {
          name: "",
          scheme: "mongodb",
          host: "",
          database: "",
          user: "",
          password: "",
          authSource: "",
          tls: "default",
        },
  });

  const scheme = form.watch("scheme");

  const handleSubmit = async (data: MongoFormData) => {
    const { name, ...credentials } = data;
    await onSubmit({ name, credentials });
    form.reset();
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Connect a MongoDB database to read and write documents from events and
          workflows. Use a least-privilege database user (read-only for
          query-only workflows). Credentials are encrypted at rest.
        </AlertDescription>
      </Alert>

      <div>
        <Label htmlFor="name">Configuration Name</Label>
        <Input
          id="name"
          placeholder="Analytics MongoDB"
          {...form.register("name")}
        />
      </div>

      <div>
        <Label htmlFor="scheme">Connection Type</Label>
        <Controller
          control={form.control}
          name="scheme"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="scheme">
                <SelectValue placeholder="Select a connection type" />
              </SelectTrigger>
              <SelectContent>
                {MONGO_SCHEMES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SCHEME_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className={scheme === "mongodb+srv" ? "col-span-3" : "col-span-2"}>
          <Label htmlFor="host">Host</Label>
          <Input
            id="host"
            placeholder={
              scheme === "mongodb+srv"
                ? "cluster0.example.mongodb.net"
                : "mongo.example.com"
            }
            {...form.register("host")}
          />
        </div>
        {scheme !== "mongodb+srv" && (
          <div>
            <Label htmlFor="port">Port</Label>
            <Input
              id="port"
              type="number"
              placeholder={String(DEFAULT_MONGO_PORT)}
              {...form.register("port", {
                setValueAs: (v) =>
                  v === "" || v === null || v === undefined
                    ? undefined
                    : Number(v),
              })}
            />
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="database">Database</Label>
        <Input
          id="database"
          placeholder="app_production"
          {...form.register("database")}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="user">User</Label>
          <Input id="user" placeholder="readonly" {...form.register("user")} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            {...form.register("password")}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="authSource">Auth Source (optional)</Label>
          <Input
            id="authSource"
            placeholder="admin"
            {...form.register("authSource")}
          />
        </div>
        <div>
          <Label htmlFor="tls">TLS</Label>
          <Controller
            control={form.control}
            name="tls"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="tls">
                  <SelectValue placeholder="Select TLS mode" />
                </SelectTrigger>
                <SelectContent>
                  {MONGO_TLS_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        <code>default</code> follows the connection type (SRV connections use
        TLS automatically); <code>enable</code>/<code>disable</code> force it.
      </p>

      <TestConnectionButton
        type="mongodb"
        toolId={tool?.id}
        getCredentials={() => {
          const { name: _name, ...creds } = form.getValues();
          return creds;
        }}
      />

      <div className="flex gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{tool ? "Update" : "Create"}</Button>
      </div>
    </form>
  );
}

function MongoCredentialDisplay({
  tools,
  onEdit,
  onDelete,
}: CredentialDisplayProps) {
  return (
    <div className="space-y-3">
      {tools.map((tool) => {
        const credentials: MongoCredentials =
          typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as MongoCredentials)
            : (tool.credentials as MongoCredentials);

        return (
          <div
            key={tool.id}
            className="border-border hover:bg-muted/50 flex items-center justify-between rounded-lg border p-4"
          >
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-3">
                <h4 className="font-medium">{tool.name}</h4>
                <StatusBadge status={tool.isActive ? "active" : "offline"} />
                <ToolHealthBadge toolId={tool.id} />
              </div>
              <div className="text-muted-foreground grid grid-cols-1 gap-1 text-sm">
                <span className="font-mono text-xs">
                  {credentials.scheme}://
                  {credentials.user ? `${credentials.user}@` : ""}
                  {credentials.host}
                  {credentials.scheme === "mongodb" && credentials.port
                    ? `:${credentials.port}`
                    : ""}
                  /{credentials.database}
                </span>
                <span className="text-xs">TLS: {credentials.tls}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onEdit(tool)}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(tool.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}

      {tools.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No MongoDB Databases</CardTitle>
            <CardDescription>
              Connect a MongoDB database (self-hosted or Atlas) to read and
              write documents from events and workflows.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground mt-2 list-inside list-disc text-sm">
              <li>Find and aggregate documents and pass them downstream</li>
              <li>
                Insert, update, and delete documents as explicit write actions
              </li>
              <li>
                Use {"{{cronium.input.*}}"} values inside JSON filters and
                documents
              </li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const MongoDbPlugin: ToolPlugin = {
  id: "mongodb",
  name: "MongoDB",
  description: "Read and write MongoDB documents from events and workflows",
  icon: MongoDbIcon,
  category: "Data",
  categoryIcon: "Database",

  schema: mongoCredentialsSchema,
  defaultValues: {
    scheme: "mongodb",
    host: "",
    database: "",
    user: "",
    password: "",
    tls: "default",
  },

  CredentialForm: MongoCredentialForm,
  CredentialDisplay: MongoCredentialDisplay,

  actions: Object.values(mongoActions),
  getActionById: (id: string) => mongoActions[id],
  getActionsByType: (type: string) =>
    Object.values(mongoActions).filter((action) => action.actionType === type),

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = mongoCredentialsSchema.safeParse(credentials);
    return result.success
      ? { isValid: true }
      : {
          isValid: false,
          error: result.error.issues[0]?.message ?? "Invalid credentials",
        };
  },

  async test(
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; message: string }> {
    const { testConnection } = await import("./connection-test");
    const result = await testConnection(credentials);
    return { success: result.success, message: result.message };
  },
};
