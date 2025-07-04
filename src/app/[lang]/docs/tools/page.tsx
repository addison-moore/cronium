import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Settings,
  Mail,
  MessageSquare,
  Key,
  FileText,
  ArrowRight,
  Plus,
  Edit,
  Trash2,
  TestTube,
  Shield,
  User,
  Eye,
  EyeOff,
  Code,
} from "lucide-react";
import { SimpleCodeBlock } from "@/components/docs/api-code-examples";

const tableOfContents = [
  { title: "Overview", href: "#overview", level: 2 },
  { title: "Available Tools", href: "#available-tools", level: 2 },
  { title: "Managing Credentials", href: "#credentials", level: 2 },
  { title: "Template Management", href: "#templates", level: 2 },
  { title: "Tool Configuration", href: "#configuration", level: 2 },
  { title: "Using the Tool Manager", href: "#tool-manager", level: 2 },
  { title: "Best Practices", href: "#best-practices", level: 2 },
];

export default async function ToolsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  return (
    <DocsLayout lang={lang} tableOfContents={tableOfContents}>
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <div className="mb-4 flex items-center gap-3">
            <div className="bg-primary/10 rounded-lg p-2">
              <Settings className="text-primary h-6 w-6" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Tools</h1>
          </div>
          <p className="text-muted-foreground text-xl">
            Configure communication tools and manage credentials for automated
            notifications and messaging in your workflows.
          </p>
        </div>

        {/* Overview */}
        <section id="overview" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Overview</h2>

          <div className="prose prose-gray dark:prose-invert mb-8 max-w-none">
            <p>
              Tools in Cronium are communication integrations that enable you to
              send notifications and messages when events complete. Each tool
              requires credentials for authentication and supports custom
              templates for message formatting.
            </p>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Key className="h-5 w-5 text-blue-500" />
                  Credentials
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Securely store authentication details for each communication
                  service
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-green-500" />
                  Templates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Create reusable message templates with dynamic content and
                  formatting
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TestTube className="h-5 w-5 text-purple-500" />
                  Testing
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Validate credentials and test message delivery before
                  deployment
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Available Tools */}
        <section id="available-tools" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Available Tools</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Cronium currently supports three communication tools, each with
              specific features and use cases for different notification
              requirements.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-500" />
                  Email
                </CardTitle>
                <CardDescription>
                  Send HTML and text emails via SMTP
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 font-medium">Required Credentials</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• SMTP Host and Port</li>
                        <li>• Username and Password</li>
                        <li>• From Email Address</li>
                        <li>• From Display Name</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="mb-2 font-medium">Features</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• HTML and plain text support</li>
                        <li>• Multiple recipients</li>
                        <li>• Custom subject lines</li>
                        <li>• Template variables</li>
                      </ul>
                    </div>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      <strong>Use cases:</strong> Error alerts, success
                      notifications, daily reports, system status updates
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-green-500" />
                  Slack
                </CardTitle>
                <CardDescription>
                  Send rich messages to Slack channels via webhooks
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 font-medium">Required Credentials</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• Webhook URL</li>
                        <li>• Channel is determined by webhook</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="mb-2 font-medium">Features</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• Slack Block Kit support</li>
                        <li>• Rich formatting and colors</li>
                        <li>• Attachments and fields</li>
                        <li>• Plain text and JSON messages</li>
                      </ul>
                    </div>
                  </div>
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/20">
                    <p className="text-sm text-green-700 dark:text-green-300">
                      <strong>Use cases:</strong> Team notifications, build
                      status, deployment alerts, automated reports
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-purple-500" />
                  Discord
                </CardTitle>
                <CardDescription>
                  Send messages with embeds to Discord channels via webhooks
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 font-medium">Required Credentials</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• Discord Webhook URL</li>
                        <li>• Channel is determined by webhook</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="mb-2 font-medium">Features</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• Rich embeds with colors</li>
                        <li>• Custom fields and formatting</li>
                        <li>• Thumbnails and images</li>
                        <li>• User mentions and roles</li>
                      </ul>
                    </div>
                  </div>
                  <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950/20">
                    <p className="text-sm text-purple-700 dark:text-purple-300">
                      <strong>Use cases:</strong> Gaming communities,
                      development teams, server monitoring, bot notifications
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Managing Credentials */}
        <section id="credentials" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Managing Credentials</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Credentials are securely stored and encrypted authentication
              details that allow Cronium to connect to external services. Each
              tool type has specific credential requirements.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Adding New Credentials</CardTitle>
                <CardDescription>
                  Steps to configure authentication for communication tools
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                    <div className="flex flex-col items-center rounded-lg border p-4 text-center">
                      <div className="bg-primary/10 text-primary mb-2 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">
                        1
                      </div>
                      <h4 className="mb-1 font-medium">Select Tool</h4>
                      <p className="text-muted-foreground text-xs">
                        Choose Email, Slack, or Discord
                      </p>
                    </div>
                    <div className="flex flex-col items-center rounded-lg border p-4 text-center">
                      <div className="bg-primary/10 text-primary mb-2 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">
                        2
                      </div>
                      <h4 className="mb-1 font-medium">Add Credentials</h4>
                      <p className="text-muted-foreground text-xs">
                        Click "Add New" button
                      </p>
                    </div>
                    <div className="flex flex-col items-center rounded-lg border p-4 text-center">
                      <div className="bg-primary/10 text-primary mb-2 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">
                        3
                      </div>
                      <h4 className="mb-1 font-medium">Fill Details</h4>
                      <p className="text-muted-foreground text-xs">
                        Enter authentication information
                      </p>
                    </div>
                    <div className="flex flex-col items-center rounded-lg border p-4 text-center">
                      <div className="bg-primary/10 text-primary mb-2 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">
                        4
                      </div>
                      <h4 className="mb-1 font-medium">Test & Save</h4>
                      <p className="text-muted-foreground text-xs">
                        Validate and store credentials
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Credential Security</CardTitle>
                <CardDescription>
                  How your authentication data is protected
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <h4 className="font-medium">Encryption</h4>
                    <div className="text-muted-foreground space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-green-500" />
                        <span>AES-256-GCM encryption at rest</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-green-500" />
                        <span>Client-side encryption before transmission</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-green-500" />
                        <span>Secure master key management</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h4 className="font-medium">Access Control</h4>
                    <div className="text-muted-foreground space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-blue-500" />
                        <span>User-scoped credential access</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-blue-500" />
                        <span>Masked display in interfaces</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-blue-500" />
                        <span>Session-based authentication</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Credential Management Actions</CardTitle>
                <CardDescription>
                  Available operations for managing stored credentials
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Edit className="h-5 w-5 text-blue-500" />
                      <h4 className="font-medium">Edit</h4>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Update authentication details and connection settings
                    </p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <TestTube className="h-5 w-5 text-green-500" />
                      <h4 className="font-medium">Test</h4>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Verify connectivity and send test messages
                    </p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Trash2 className="h-5 w-5 text-red-500" />
                      <h4 className="font-medium">Delete</h4>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Remove credentials and revoke access permanently
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Template Management */}
        <section id="templates" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Template Management</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Templates define the format and content of messages sent through
              tools. Each tool type supports specific template formats and
              features for optimal message presentation.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Template Types by Tool</CardTitle>
                <CardDescription>
                  Different formatting requirements for each communication tool
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-lg border p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Mail className="h-5 w-5 text-blue-500" />
                        <h4 className="font-medium">Email Templates</h4>
                      </div>
                      <div className="text-muted-foreground space-y-2 text-sm">
                        <div>• HTML format support</div>
                        <div>• Subject line templates</div>
                        <div>• Plain text fallback</div>
                        <div>• Email-specific variables</div>
                      </div>
                    </div>
                    <div className="rounded-lg border p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-green-500" />
                        <h4 className="font-medium">Slack Templates</h4>
                      </div>
                      <div className="text-muted-foreground space-y-2 text-sm">
                        <div>• JSON Block Kit format</div>
                        <div>• Markdown support</div>
                        <div>• Interactive elements</div>
                        <div>• Rich formatting options</div>
                      </div>
                    </div>
                    <div className="rounded-lg border p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-purple-500" />
                        <h4 className="font-medium">Discord Templates</h4>
                      </div>
                      <div className="text-muted-foreground space-y-2 text-sm">
                        <div>• JSON embed format</div>
                        <div>• Rich embed fields</div>
                        <div>• Color customization</div>
                        <div>• Image and thumbnail support</div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Creating and Editing Templates</CardTitle>
                <CardDescription>
                  How to manage custom message templates for your tools
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                      <h4 className="mb-3 font-medium">Template Creation</h4>
                      <div className="text-muted-foreground space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          <ArrowRight className="h-4 w-4" />
                          <span>Navigate to tool's Templates tab</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowRight className="h-4 w-4" />
                          <span>Click "Add Template" button</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowRight className="h-4 w-4" />
                          <span>Enter template name and content</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowRight className="h-4 w-4" />
                          <span>Use Handlebars syntax for variables</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowRight className="h-4 w-4" />
                          <span>Save and test template</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="mb-3 font-medium">Template Features</h4>
                      <div className="text-muted-foreground space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-blue-500" />
                          <span>
                            Monaco code editor with syntax highlighting
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Eye className="h-4 w-4 text-green-500" />
                          <span>Real-time template preview</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Key className="h-4 w-4 text-purple-500" />
                          <span>Variable reference tooltips</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-orange-500" />
                          <span>Template validation and error checking</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20">
                    <div className="flex items-start gap-3">
                      <div className="rounded bg-blue-100 p-1 dark:bg-blue-900">
                        <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h4 className="mb-1 font-medium text-blue-800 dark:text-blue-200">
                          Template Documentation
                        </h4>
                        <p className="text-sm text-blue-700 dark:text-blue-300">
                          For detailed information about template syntax,
                          variables, and helpers, see the
                          <a
                            href={`/${lang}/docs/templates`}
                            className="ml-1 underline"
                          >
                            Templates documentation
                          </a>
                          .
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Tool Configuration */}
        <section id="configuration" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Tool Configuration</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Each tool has specific configuration requirements and setup
              procedures. Follow these guides to properly configure
              authentication for each communication service.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-500" />
                  Email Configuration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 font-medium">SMTP Settings</h4>
                      <SimpleCodeBlock language="text" className="text-sm">
                        {`Host: smtp.gmail.com
Port: 587 (TLS) or 465 (SSL)
Security: STARTTLS or SSL/TLS`}
                      </SimpleCodeBlock>
                    </div>
                    <div>
                      <h4 className="mb-2 font-medium">Authentication</h4>
                      <SimpleCodeBlock language="text" className="text-sm">
                        {`Username: your-email@domain.com
Password: your-password or app-password
From Email: sender@domain.com
From Name: Cronium Notifications`}
                      </SimpleCodeBlock>
                    </div>
                  </div>
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/20">
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      <strong>Note:</strong> For Gmail and other providers, use
                      app-specific passwords instead of your regular account
                      password.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-green-500" />
                  Slack Configuration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-medium">Webhook Setup</h4>
                    <div className="text-muted-foreground space-y-2 text-sm">
                      <div className="flex items-start gap-2">
                        <span className="bg-muted rounded px-1 font-mono">
                          1.
                        </span>
                        <span>Go to your Slack workspace settings</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="bg-muted rounded px-1 font-mono">
                          2.
                        </span>
                        <span>Navigate to "Apps" → "Incoming Webhooks"</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="bg-muted rounded px-1 font-mono">
                          3.
                        </span>
                        <span>
                          Create a new webhook for your target channel
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="bg-muted rounded px-1 font-mono">
                          4.
                        </span>
                        <span>
                          Copy the webhook URL for Cronium configuration
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/20">
                    <p className="text-sm text-green-700 dark:text-green-300">
                      <strong>Webhook URL format:</strong>{" "}
                      https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-purple-500" />
                  Discord Configuration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-medium">Webhook Setup</h4>
                    <div className="text-muted-foreground space-y-2 text-sm">
                      <div className="flex items-start gap-2">
                        <span className="bg-muted rounded px-1 font-mono">
                          1.
                        </span>
                        <span>Open Discord and go to your target channel</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="bg-muted rounded px-1 font-mono">
                          2.
                        </span>
                        <span>Right-click the channel → "Edit Channel"</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="bg-muted rounded px-1 font-mono">
                          3.
                        </span>
                        <span>Go to "Integrations" → "Webhooks"</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="bg-muted rounded px-1 font-mono">
                          4.
                        </span>
                        <span>Create a new webhook and copy the URL</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950/20">
                    <p className="text-sm text-purple-700 dark:text-purple-300">
                      <strong>Webhook URL format:</strong>{" "}
                      https://discord.com/api/webhooks/123456789/abcdefghijk...
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Using the Tool Manager */}
        <section id="tool-manager" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Using the Tool Manager</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              The Tool Manager is located in your user settings and provides a
              comprehensive interface for managing all your communication tools,
              credentials, and templates.
            </p>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Accessing the Tool Manager</CardTitle>
              <CardDescription>
                Navigate to the tools management interface
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="bg-muted/50 flex items-center gap-4 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-blue-500" />
                    <span className="font-medium">User Settings</span>
                  </div>
                  <ArrowRight className="text-muted-foreground h-4 w-4" />
                  <div className="flex items-center gap-2">
                    <Settings className="h-4 w-4 text-green-500" />
                    <span className="font-medium">Tools Tab</span>
                  </div>
                  <ArrowRight className="text-muted-foreground h-4 w-4" />
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-purple-500" />
                    <span className="font-medium">Select Tool Type</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Interface Layout</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-blue-500"></div>
                    <div>
                      <p className="font-medium">Tool Selection Sidebar</p>
                      <p className="text-muted-foreground text-sm">
                        Choose between Email, Slack, and Discord
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-green-500"></div>
                    <div>
                      <p className="font-medium">Tabbed Interface</p>
                      <p className="text-muted-foreground text-sm">
                        Switch between Credentials and Templates
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-purple-500"></div>
                    <div>
                      <p className="font-medium">Management Forms</p>
                      <p className="text-muted-foreground text-sm">
                        Add, edit, and delete credentials and templates
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded border p-2">
                    <Plus className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium">Add New</span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      Create credentials/templates
                    </span>
                  </div>
                  <div className="flex items-center gap-3 rounded border p-2">
                    <Edit className="h-4 w-4 text-blue-500" />
                    <span className="text-sm font-medium">Edit</span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      Modify existing items
                    </span>
                  </div>
                  <div className="flex items-center gap-3 rounded border p-2">
                    <TestTube className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium">Test</span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      Validate connections
                    </span>
                  </div>
                  <div className="flex items-center gap-3 rounded border p-2">
                    <Trash2 className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium">Delete</span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      Remove items permanently
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Best Practices */}
        <section id="best-practices" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Best Practices</h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-green-600">
                  Security & Management
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Shield className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                    <div>
                      <p className="font-medium">
                        Use dedicated service accounts
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Create separate accounts for automation
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Key className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                    <div>
                      <p className="font-medium">
                        Rotate credentials regularly
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Update passwords and tokens periodically
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <TestTube className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                    <div>
                      <p className="font-medium">Test before deployment</p>
                      <p className="text-muted-foreground text-sm">
                        Verify all credentials work correctly
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Eye className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                    <div>
                      <p className="font-medium">Monitor delivery status</p>
                      <p className="text-muted-foreground text-sm">
                        Check logs for failed notifications
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-blue-600">
                  Template & Content
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <FileText className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
                    <div>
                      <p className="font-medium">Create reusable templates</p>
                      <p className="text-muted-foreground text-sm">
                        Build template library for consistency
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Settings className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
                    <div>
                      <p className="font-medium">Use descriptive names</p>
                      <p className="text-muted-foreground text-sm">
                        Name templates clearly for easy selection
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Code className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
                    <div>
                      <p className="font-medium">Validate JSON syntax</p>
                      <p className="text-muted-foreground text-sm">
                        Test Slack/Discord JSON templates thoroughly
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <User className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
                    <div>
                      <p className="font-medium">Include relevant context</p>
                      <p className="text-muted-foreground text-sm">
                        Add event details and execution information
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </DocsLayout>
  );
}
