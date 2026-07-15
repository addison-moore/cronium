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
import { SqlIcon } from "./sql-icon";
import { sqlActions } from "./actions";
import {
  sqlCredentialsSchema,
  SQL_DIALECTS,
  SSL_MODES,
  defaultPort,
  type SqlCredentials,
  type SqlDialectValue,
} from "./schemas";

// Dedicated form schema (no z.coerce/defaults) so the react-hook-form resolver
// has matching input/output types under exactOptionalPropertyTypes. The `port`
// field is converted to a number via register's setValueAs; defaults are
// supplied through useForm's defaultValues. The server validates the stricter
// sqlCredentialsSchema on save.
const sqlFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  dialect: z.enum(SQL_DIALECTS),
  host: z.string().min(1, "Host is required"),
  port: z.number().int().positive().max(65535).optional(),
  database: z.string().min(1, "Database is required"),
  user: z.string().min(1, "User is required"),
  password: z.string().optional(),
  ssl: z.enum(SSL_MODES),
});
type SqlFormData = z.infer<typeof sqlFormSchema>;

const DIALECT_LABELS: Record<SqlDialectValue, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
};

function SqlCredentialForm({ tool, onSubmit, onCancel }: CredentialFormProps) {
  const form = useForm<SqlFormData>({
    resolver: zodResolver(sqlFormSchema),
    defaultValues: tool
      ? {
          name: tool.name,
          ...(typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as SqlCredentials)
            : (tool.credentials as SqlCredentials)),
        }
      : {
          name: "",
          dialect: "postgres",
          host: "",
          database: "",
          user: "",
          password: "",
          ssl: "require",
        },
  });

  const dialect = form.watch("dialect");

  const handleSubmit = async (data: SqlFormData) => {
    const { name, ...credentials } = data;
    await onSubmit({ name, credentials });
    form.reset();
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Connect a SQL database to run queries from events and workflows. Use a
          least-privilege database user (read-only for query-only workflows).
          Credentials are encrypted at rest.
        </AlertDescription>
      </Alert>

      <div>
        <Label htmlFor="name">Configuration Name</Label>
        <Input
          id="name"
          placeholder="Analytics DB"
          {...form.register("name")}
        />
      </div>

      <div>
        <Label htmlFor="dialect">Database Type</Label>
        <Controller
          control={form.control}
          name="dialect"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="dialect">
                <SelectValue placeholder="Select a database" />
              </SelectTrigger>
              <SelectContent>
                {SQL_DIALECTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DIALECT_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Label htmlFor="host">Host</Label>
          <Input
            id="host"
            placeholder="db.example.com"
            {...form.register("host")}
          />
        </div>
        <div>
          <Label htmlFor="port">Port</Label>
          <Input
            id="port"
            type="number"
            placeholder={String(defaultPort(dialect ?? "postgres"))}
            {...form.register("port", {
              setValueAs: (v) =>
                v === "" || v === null || v === undefined
                  ? undefined
                  : Number(v),
            })}
          />
        </div>
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

      <div>
        <Label htmlFor="ssl">SSL Mode</Label>
        <Controller
          control={form.control}
          name="ssl"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="ssl">
                <SelectValue placeholder="Select SSL mode" />
              </SelectTrigger>
              <SelectContent>
                {SSL_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-muted-foreground mt-1 text-xs">
          <code>require</code> encrypts without CA validation;{" "}
          <code>verify-full</code> validates the server certificate.
        </p>
      </div>

      <TestConnectionButton
        type="sql"
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

function SqlCredentialDisplay({
  tools,
  onEdit,
  onDelete,
}: CredentialDisplayProps) {
  return (
    <div className="space-y-3">
      {tools.map((tool) => {
        const credentials: SqlCredentials =
          typeof tool.credentials === "string"
            ? (JSON.parse(tool.credentials) as SqlCredentials)
            : (tool.credentials as SqlCredentials);

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
                  {DIALECT_LABELS[credentials.dialect] ?? credentials.dialect} ·{" "}
                  {credentials.user}@{credentials.host}
                  {credentials.port ? `:${credentials.port}` : ""}/
                  {credentials.database}
                </span>
                <span className="text-xs">SSL: {credentials.ssl}</span>
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

      {tools.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No SQL Databases</CardTitle>
            <CardDescription>
              Connect a PostgreSQL or MySQL database to query it from events and
              workflows.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground mt-2 list-inside list-disc text-sm">
              <li>Run parameterized read queries and pass rows downstream</li>
              <li>
                Execute writes (INSERT/UPDATE/DELETE) as an explicit action
              </li>
              <li>
                Use {"{{cronium.input.*}}"} values as safe bound parameters
              </li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const SqlPlugin: ToolPlugin = {
  id: "sql",
  name: "SQL Database",
  description: "Query PostgreSQL and MySQL databases from events and workflows",
  icon: SqlIcon,
  category: "Data",
  categoryIcon: "Database",

  schema: sqlCredentialsSchema,
  defaultValues: {
    dialect: "postgres",
    host: "",
    database: "",
    user: "",
    password: "",
    ssl: "require",
  },

  CredentialForm: SqlCredentialForm,
  CredentialDisplay: SqlCredentialDisplay,

  actions: Object.values(sqlActions),
  getActionById: (id: string) => sqlActions[id],
  getActionsByType: (type: string) =>
    Object.values(sqlActions).filter((action) => action.actionType === type),

  async validate(
    credentials: Record<string, unknown>,
  ): Promise<{ isValid: boolean; error?: string }> {
    const result = sqlCredentialsSchema.safeParse(credentials);
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
