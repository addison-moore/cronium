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
import {
  FileText,
  Code,
  Database,
  Settings,
  ArrowRight,
  Zap,
  User,
  AlertCircle,
  Shield,
} from "lucide-react";
import { SimpleCodeBlock } from "@/components/docs/api-code-examples";

// DEPRECATED PAGE - This documents the old template system
// TODO: Update this page to document the new Tool Action Templates system

const tableOfContents = [
  { title: "DEPRECATED - Overview", href: "#overview", level: 2 },
  { title: "Handlebars Syntax", href: "#handlebars-syntax", level: 2 },
  { title: "Context Variables", href: "#context-variables", level: 2 },
  { title: "Template Helpers", href: "#template-helpers", level: 2 },
  { title: "Template Examples", href: "#examples", level: 2 },
  { title: "System vs User Templates", href: "#template-types", level: 2 },
  { title: "Best Practices", href: "#best-practices", level: 2 },
];

export default async function TemplatesPage({
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
              <FileText className="text-primary h-6 w-6" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Templates</h1>
          </div>
          <p className="text-muted-foreground text-xl">
            Create dynamic message templates with Handlebars syntax and runtime
            context variables for powerful automation messaging.
          </p>
        </div>

        {/* Overview */}
        <section id="overview" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Overview</h2>

          <div className="prose prose-gray dark:prose-invert mb-8 max-w-none">
            <p>
              Templates in Cronium use Handlebars syntax to create dynamic
              messages that automatically include event data, runtime variables,
              and custom conditions. Templates are used in conditional actions
              for email, Slack, and Discord notifications.
            </p>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Code className="h-5 w-5 text-blue-500" />
                  Handlebars
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Use familiar Handlebars syntax with double curly braces for
                  dynamic content
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Database className="h-5 w-5 text-green-500" />
                  Context Data
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Access event details, variables, input data, and conditions
                  automatically
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Settings className="h-5 w-5 text-purple-500" />
                  Helpers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Built-in helpers for formatting, conditions, and safe data
                  access
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Handlebars Syntax */}
        <section id="handlebars-syntax" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Handlebars Syntax</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Cronium templates use standard Handlebars syntax with the{" "}
              <code>cronium</code> namespace to access runtime data and context
              variables.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Basic Variable Access</CardTitle>
                <CardDescription>
                  Access event data using the cronium namespace
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SimpleCodeBlock language="handlebars" className="mb-4">
                  {`{{cronium.event.name}}
{{cronium.event.status}}
{{cronium.event.duration}}
{{cronium.event.executionTime}}`}
                </SimpleCodeBlock>
                <p className="text-muted-foreground text-sm">
                  Use dot notation to access nested properties in the cronium
                  context.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Conditional Blocks</CardTitle>
                <CardDescription>
                  Show content based on conditions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SimpleCodeBlock language="handlebars" className="mb-4">
                  {`{{#ifEquals cronium.event.status "success"}}
  ✅ Event completed successfully!
{{else}}
  ❌ Event failed or encountered errors.
{{/ifEquals}}

{{#if cronium.event.output}}
  Output: {{cronium.event.output}}
{{/if}}`}
                </SimpleCodeBlock>
                <p className="text-muted-foreground text-sm">
                  Use built-in helpers for conditional rendering based on event
                  data.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Safe Property Access</CardTitle>
                <CardDescription>
                  Access nested properties safely with fallbacks
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SimpleCodeBlock language="handlebars" className="mb-4">
                  {`{{get cronium.getVariables "database.host" "localhost"}}
{{get cronium.input "user.name" "Unknown User"}}
{{get cronium.event "server" "Local"}}`}
                </SimpleCodeBlock>
                <p className="text-muted-foreground text-sm">
                  Use the <code>get</code> helper to safely access nested
                  properties with default values.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Context Variables */}
        <section id="context-variables" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Context Variables</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Templates have access to a rich context of runtime data through
              the <code>cronium</code> namespace. All data is automatically
              populated based on the current event execution.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-blue-500" />
                  cronium.event
                </CardTitle>
                <CardDescription>
                  Current event execution details
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          id
                        </Badge>
                        <span className="text-sm">Event ID number</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          name
                        </Badge>
                        <span className="text-sm">Event display name</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          status
                        </Badge>
                        <span className="text-sm">Execution status</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          duration
                        </Badge>
                        <span className="text-sm">Runtime in milliseconds</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          executionTime
                        </Badge>
                        <span className="text-sm">Start timestamp</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          server
                        </Badge>
                        <span className="text-sm">Execution server name</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          output
                        </Badge>
                        <span className="text-sm">Script output content</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          error
                        </Badge>
                        <span className="text-sm">Error message (if any)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-green-500" />
                  cronium.getVariables
                </CardTitle>
                <CardDescription>
                  User-defined variables from the Variables system
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <SimpleCodeBlock language="handlebars">
                    {`{{cronium.getVariables.api_key}}
{{cronium.getVariables.database_url}}
{{get cronium.getVariables "config.timeout" "30"}}`}
                  </SimpleCodeBlock>
                  <p className="text-muted-foreground text-sm">
                    Access variables created through the Variables system in
                    user settings.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowRight className="h-5 w-5 text-purple-500" />
                  cronium.input
                </CardTitle>
                <CardDescription>
                  Input data passed to the event (workflow context)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <SimpleCodeBlock language="handlebars">
                    {`{{cronium.input.user_id}}
{{cronium.input.message}}
{{get cronium.input "config.retries" "3"}}`}
                  </SimpleCodeBlock>
                  <p className="text-muted-foreground text-sm">
                    Data passed from workflow nodes or API calls to the current
                    event.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-orange-500" />
                  cronium.getCondition
                </CardTitle>
                <CardDescription>
                  Custom conditions set by cronium.setCondition()
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <SimpleCodeBlock language="handlebars">
                    {`{{#if cronium.getCondition.data_valid}}
  Data validation passed
{{/if}}

{{#ifEquals cronium.getCondition.environment "production"}}
  Running in production mode
{{/ifEquals}}`}
                  </SimpleCodeBlock>
                  <p className="text-muted-foreground text-sm">
                    Boolean conditions set during script execution using
                    cronium.setCondition().
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Template Helpers */}
        <section id="template-helpers" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Template Helpers</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Cronium provides built-in Handlebars helpers for common
              formatting, conditional logic, and safe data access operations.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>get</CardTitle>
                <CardDescription>
                  Safe property access with optional fallback values
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <SimpleCodeBlock language="handlebars">
                    {`{{get cronium.event "output" "No output available"}}
{{get cronium.getVariables "database.port" "5432"}}
{{get cronium.input "user.email" "unknown@example.com"}}`}
                  </SimpleCodeBlock>
                  <p className="text-muted-foreground text-sm">
                    Parameters: <code>object</code>, <code>path</code>,{" "}
                    <code>fallback</code> (optional)
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ifEquals</CardTitle>
                <CardDescription>
                  Conditional rendering based on value equality
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <SimpleCodeBlock language="handlebars">
                    {`{{#ifEquals cronium.event.status "success"}}
  🎉 Success message
{{else}}
  ⚠️ Error or failure message
{{/ifEquals}}`}
                  </SimpleCodeBlock>
                  <p className="text-muted-foreground text-sm">
                    Parameters: <code>value1</code>, <code>value2</code>
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>formatDuration</CardTitle>
                <CardDescription>
                  Format milliseconds into human-readable duration
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <SimpleCodeBlock language="handlebars">
                    {`Duration: {{formatDuration cronium.event.duration}}
<!-- Output: "2.5s", "1.2m", "45ms", etc. -->`}
                  </SimpleCodeBlock>
                  <p className="text-muted-foreground text-sm">
                    Converts milliseconds to readable format (ms, s, m, h)
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>formatTime</CardTitle>
                <CardDescription>
                  Format ISO timestamps into readable dates
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <SimpleCodeBlock language="handlebars">
                    {`Started: {{formatTime cronium.event.executionTime}}
<!-- Output: "12/27/2024, 2:30:45 PM" -->`}
                  </SimpleCodeBlock>
                  <p className="text-muted-foreground text-sm">
                    Converts ISO timestamp to localized date/time string
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>json</CardTitle>
                <CardDescription>
                  Convert objects to formatted JSON (useful for debugging)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <SimpleCodeBlock language="handlebars">
                    {`Debug info: {{json cronium.input}}
Variables: {{json cronium.getVariables}}`}
                  </SimpleCodeBlock>
                  <p className="text-muted-foreground text-sm">
                    Outputs pretty-printed JSON for complex objects
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>lookup</CardTitle>
                <CardDescription>
                  Dynamic property access using variables
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <SimpleCodeBlock language="handlebars">
                    {`{{lookup cronium.getVariables "api_key"}}
{{lookup cronium.event "status"}}`}
                  </SimpleCodeBlock>
                  <p className="text-muted-foreground text-sm">
                    Access object properties using dynamic field names
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Examples */}
        <section id="examples" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Template Examples</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Here are practical examples of templates for different
              communication tools and use cases.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  📧 Email Template
                </CardTitle>
                <CardDescription>
                  HTML email template for event notifications
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SimpleCodeBlock language="html">
                  {`<h2>{{#ifEquals cronium.event.status "success"}}✅{{else}}❌{{/ifEquals}} Event: {{cronium.event.name}}</h2>

<p><strong>Status:</strong> {{cronium.event.status}}</p>
<p><strong>Duration:</strong> {{formatDuration cronium.event.duration}}</p>
<p><strong>Started:</strong> {{formatTime cronium.event.executionTime}}</p>

{{#if cronium.event.server}}
<p><strong>Server:</strong> {{cronium.event.server}}</p>
{{/if}}

{{#if cronium.event.output}}
<h3>Output:</h3>
<pre>{{cronium.event.output}}</pre>
{{/if}}

{{#if cronium.event.error}}
<h3>Error Details:</h3>
<p style="color: red;">{{cronium.event.error}}</p>
{{/if}}`}
                </SimpleCodeBlock>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  💬 Slack Template
                </CardTitle>
                <CardDescription>
                  JSON Block Kit template for Slack notifications
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SimpleCodeBlock language="json">
                  {`{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "{{#ifEquals cronium.event.status 'success'}}✅{{else}}❌{{/ifEquals}} {{cronium.event.name}}"
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": "*Status:* {{cronium.event.status}}"
        },
        {
          "type": "mrkdwn",
          "text": "*Duration:* {{formatDuration cronium.event.duration}}"
        },
        {
          "type": "mrkdwn",
          "text": "*Started:* {{formatTime cronium.event.executionTime}}"
        }{{#if cronium.event.server}},
        {
          "type": "mrkdwn",
          "text": "*Server:* {{cronium.event.server}}"
        }{{/if}}
      ]
    }{{#if cronium.event.output}},
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Output:*\n\`\`\`{{cronium.event.output}}\`\`\`"
      }
    }{{/if}}
  ]
}`}
                </SimpleCodeBlock>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  🎮 Discord Template
                </CardTitle>
                <CardDescription>
                  JSON embed template for Discord webhooks
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SimpleCodeBlock language="json">
                  {`{
  "embeds": [
    {
      "title": "{{cronium.event.name}}",
      "color": {{#ifEquals cronium.event.status "success"}}65280{{else}}16711680{{/ifEquals}},
      "fields": [
        {
          "name": "Status",
          "value": "{{cronium.event.status}}",
          "inline": true
        },
        {
          "name": "Duration",
          "value": "{{formatDuration cronium.event.duration}}",
          "inline": true
        },
        {
          "name": "Started",
          "value": "{{formatTime cronium.event.executionTime}}",
          "inline": true
        }{{#if cronium.event.server}},
        {
          "name": "Server",
          "value": "{{cronium.event.server}}",
          "inline": true
        }{{/if}}{{#if cronium.event.output}},
        {
          "name": "Output",
          "value": "\`\`\`{{cronium.event.output}}\`\`\`",
          "inline": false
        }{{/if}}
      ],
      "timestamp": "{{cronium.event.executionTime}}"
    }
  ]
}`}
                </SimpleCodeBlock>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Template Types */}
        <section id="template-types" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">System vs User Templates</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Cronium provides two types of templates: system templates managed
              by administrators and user templates that you can create and
              customize.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-500" />
                  System Templates
                </CardTitle>
                <CardDescription>
                  Pre-built templates managed by administrators
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge className="border-blue-200 bg-blue-50 text-blue-700">
                      <Shield className="mr-1 h-3 w-3" />
                      System
                    </Badge>
                    <span className="text-sm">Visible to all users</span>
                  </div>
                  <div className="text-muted-foreground space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4" />
                      <span>Consistent formatting across teams</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4" />
                      <span>Read-only for regular users</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4" />
                      <span>Editable by administrators only</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4" />
                      <span>Available for all communication tools</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-green-500" />
                  User Templates
                </CardTitle>
                <CardDescription>
                  Custom templates created by individual users
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      <User className="mr-1 h-3 w-3" />
                      Personal
                    </Badge>
                    <span className="text-sm">Private to creator</span>
                  </div>
                  <div className="text-muted-foreground space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4" />
                      <span>Fully customizable content</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4" />
                      <span>Create, edit, and delete access</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4" />
                      <span>Tool-specific templates</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-4 w-4" />
                      <span>Shareable through export/import</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20">
            <div className="flex items-start gap-3">
              <div className="rounded bg-blue-100 p-1 dark:bg-blue-900">
                <Settings className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h4 className="mb-1 font-medium text-blue-800 dark:text-blue-200">
                  Template Management
                </h4>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Manage your templates in the{" "}
                  <a href={`/${lang}/docs/tools`} className="underline">
                    Tools section
                  </a>{" "}
                  of user settings. Each communication tool has its own template
                  manager for organizing templates by type.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Best Practices */}
        <section id="best-practices" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Best Practices</h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-green-600">
                  Template Design
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-green-500"></div>
                    <div>
                      <p className="font-medium">
                        Use descriptive template names
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Make templates easy to identify and select
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-green-500"></div>
                    <div>
                      <p className="font-medium">Include relevant context</p>
                      <p className="text-muted-foreground text-sm">
                        Add event name, status, and timing information
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-green-500"></div>
                    <div>
                      <p className="font-medium">Use conditional blocks</p>
                      <p className="text-muted-foreground text-sm">
                        Show different content for success vs failure
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-green-500"></div>
                    <div>
                      <p className="font-medium">Provide fallback values</p>
                      <p className="text-muted-foreground text-sm">
                        Use the get helper with defaults for optional data
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-orange-600">
                  Common Pitfalls
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-500" />
                    <div>
                      <p className="font-medium">Missing fallbacks</p>
                      <p className="text-muted-foreground text-sm">
                        Always provide defaults for optional properties
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-500" />
                    <div>
                      <p className="font-medium">
                        Invalid JSON in Slack/Discord
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Validate JSON syntax before saving templates
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-500" />
                    <div>
                      <p className="font-medium">Hardcoded values</p>
                      <p className="text-muted-foreground text-sm">
                        Use variables and context data instead of static text
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-500" />
                    <div>
                      <p className="font-medium">Overly complex templates</p>
                      <p className="text-muted-foreground text-sm">
                        Keep templates simple and focused on essential
                        information
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
