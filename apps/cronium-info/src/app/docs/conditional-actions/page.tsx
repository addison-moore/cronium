import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import { Badge } from "@cronium/ui";
import {
  Zap,
  Send,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Settings,
  ArrowRight,
  Mail,
  MessageSquare,
  Code,
} from "lucide-react";

const tableOfContents = [
  { title: "Overview", href: "#overview", level: 2 },
  { title: "Trigger Types", href: "#trigger-types", level: 2 },
  { title: "Action Types", href: "#action-types", level: 2 },
  { title: "Send Message Actions", href: "#send-message", level: 2 },
  { title: "Run Another Event", href: "#run-event", level: 2 },
  { title: "Setting Up Actions", href: "#setup", level: 2 },
  { title: "Best Practices", href: "#best-practices", level: 2 },
];

// Enable Partial Prerendering for this page
export const experimental_ppr = true;

// ISR configuration - revalidate every hour
export const revalidate = 3600; // 1 hour
export const dynamic = "force-static";
export default function ConditionalActionsPage() {
  return (
    <DocsLayout tableOfContents={tableOfContents}>
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <div className="mb-4 flex items-center gap-3">
            <div className="bg-primary/10 rounded-lg p-2">
              <Zap className="text-primary h-6 w-6" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">
              Conditional Actions
            </h1>
          </div>
          <p className="text-muted-foreground text-xl">
            Automate responses to event outcomes with powerful conditional
            actions that trigger based on success, failure, or custom
            conditions.
          </p>
        </div>

        {/* Overview */}
        <section id="overview" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Overview</h2>

          <div className="prose prose-gray dark:prose-invert mb-8 max-w-none">
            <p>
              Conditional actions allow you to automatically trigger responses
              based on the outcome of your events. Whether an event succeeds,
              fails, or meets specific conditions, you can configure automated
              actions to handle the results appropriately.
            </p>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-blue-500" />
                  Send Message
                </CardTitle>
                <CardDescription>
                  Send notifications via email, Slack, or Discord when events
                  complete
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4" />
                    Email notifications
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <MessageSquare className="h-4 w-4" />
                    Slack messages
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <MessageSquare className="h-4 w-4" />
                    Discord webhooks
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Play className="h-5 w-5 text-green-500" />
                  Run Another Event
                </CardTitle>
                <CardDescription>
                  Chain events together to create complex automation workflows
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Code className="h-4 w-4" />
                    Execute follow-up scripts
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <ArrowRight className="h-4 w-4" />
                    Chain multiple events
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Settings className="h-4 w-4" />
                    Conditional logic
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Trigger Types */}
        <section id="trigger-types" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Trigger Types</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Conditional actions can be triggered based on different event
              outcomes. Choose the appropriate trigger type for your automation
              needs.
            </p>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <CardTitle className="text-lg">On Success</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3 text-sm">
                  Triggers when the event completes successfully without errors.
                </p>
                <Badge
                  variant="secondary"
                  className="border-green-200 bg-green-50 text-green-700"
                >
                  Success Trigger
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-500" />
                  <CardTitle className="text-lg">On Failure</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3 text-sm">
                  Triggers when the event fails, times out, or encounters
                  errors.
                </p>
                <Badge
                  variant="secondary"
                  className="border-red-200 bg-red-50 text-red-700"
                >
                  Failure Trigger
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-blue-500" />
                  <CardTitle className="text-lg">Always</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3 text-sm">
                  Triggers regardless of the event outcome - success or failure.
                </p>
                <Badge
                  variant="secondary"
                  className="border-blue-200 bg-blue-50 text-blue-700"
                >
                  Always Trigger
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-purple-500" />
                  <CardTitle className="text-lg">On Condition</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3 text-sm">
                  Triggers when a custom condition is met using
                  cronium.setCondition().
                </p>
                <Badge
                  variant="secondary"
                  className="border-purple-200 bg-purple-50 text-purple-700"
                >
                  Conditional Trigger
                </Badge>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Action Types */}
        <section id="action-types" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Action Types</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Cronium supports two main types of conditional actions that can be
              triggered based on event outcomes.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-blue-500" />
                  Send Message
                </CardTitle>
                <CardDescription>
                  Send notifications through various communication channels
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-lg border p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Mail className="h-4 w-4 text-blue-500" />
                        <span className="font-medium">Email</span>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        Send HTML or text emails with custom templates
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-green-500" />
                        <span className="font-medium">Slack</span>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        Post messages with rich formatting and blocks
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-purple-500" />
                        <span className="font-medium">Discord</span>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        Send webhook messages with embeds
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Play className="h-5 w-5 text-green-500" />
                  Run Another Event
                </CardTitle>
                <CardDescription>
                  Execute other events to create automation chains
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <ArrowRight className="text-muted-foreground mt-0.5 h-5 w-5" />
                    <div>
                      <p className="font-medium">Event Chaining</p>
                      <p className="text-muted-foreground text-sm">
                        Trigger other events based on the current event's
                        outcome
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <ArrowRight className="text-muted-foreground mt-0.5 h-5 w-5" />
                    <div>
                      <p className="font-medium">Workflow Automation</p>
                      <p className="text-muted-foreground text-sm">
                        Create complex multi-step automation processes
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Send Message Actions */}
        <section id="send-message" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Send Message Actions</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Send Message actions allow you to notify team members or external
              systems about event outcomes. Each message type supports templates
              with dynamic content from your event execution.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-500" />
                  Email Messages
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 font-medium">Configuration</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• Email credentials (SMTP settings)</li>
                        <li>• Recipient addresses</li>
                        <li>• Subject line with templates</li>
                        <li>• HTML or text message body</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="mb-2 font-medium">Use Cases</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• Success notifications</li>
                        <li>• Error alerts</li>
                        <li>• Daily reports</li>
                        <li>• System status updates</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-green-500" />
                  Slack Messages
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 font-medium">Configuration</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• Webhook URL credentials</li>
                        <li>• Channel targeting via webhook</li>
                        <li>• Plain text or JSON block format</li>
                        <li>• Rich formatting support</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="mb-2 font-medium">Features</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• Slack Block Kit support</li>
                        <li>• Attachments and colors</li>
                        <li>• Mentions and channels</li>
                        <li>• Interactive elements</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-purple-500" />
                  Discord Messages
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 font-medium">Configuration</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• Discord webhook URL</li>
                        <li>• Channel targeting via webhook</li>
                        <li>• Plain text or JSON embed format</li>
                        <li>• Rich embed support</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="mb-2 font-medium">Features</h4>
                      <ul className="text-muted-foreground space-y-1 text-sm">
                        <li>• Discord embeds</li>
                        <li>• Custom colors and fields</li>
                        <li>• Thumbnail and images</li>
                        <li>• User mentions</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20">
            <div className="flex items-start gap-3">
              <div className="rounded bg-blue-100 p-1 dark:bg-blue-900">
                <Settings className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h4 className="mb-1 font-medium text-blue-800 dark:text-blue-200">
                  Template Support
                </h4>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  All message types support Handlebars templates with event
                  data, variables, and runtime helpers. See the{" "}
                  <a href={`/docs/templates`} className="underline">
                    Templates documentation
                  </a>{" "}
                  for detailed information on template syntax and available
                  variables.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Run Another Event */}
        <section id="run-event" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Run Another Event</h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              The "Run Another Event" action allows you to chain events
              together, creating complex automation workflows that respond
              dynamically to different outcomes.
            </p>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Event Chaining</CardTitle>
              <CardDescription>
                Create multi-step automation by triggering follow-up events
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="bg-muted/50 flex items-center gap-4 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-blue-500"></div>
                    <span className="font-medium">Event A</span>
                  </div>
                  <ArrowRight className="text-muted-foreground h-4 w-4" />
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">On Success</span>
                  </div>
                  <ArrowRight className="text-muted-foreground h-4 w-4" />
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-green-500"></div>
                    <span className="font-medium">Event B</span>
                  </div>
                </div>

                <div className="bg-muted/50 flex items-center gap-4 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-blue-500"></div>
                    <span className="font-medium">Event A</span>
                  </div>
                  <ArrowRight className="text-muted-foreground h-4 w-4" />
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm">On Failure</span>
                  </div>
                  <ArrowRight className="text-muted-foreground h-4 w-4" />
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-red-500"></div>
                    <span className="font-medium">Error Handler</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <h4 className="mb-1 font-medium">Target Event</h4>
                    <p className="text-muted-foreground text-sm">
                      Select which event to run from your available events
                    </p>
                  </div>
                  <div>
                    <h4 className="mb-1 font-medium">Trigger Condition</h4>
                    <p className="text-muted-foreground text-sm">
                      Choose when to trigger: Success, Failure, Always, or
                      Custom Condition
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Use Cases</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ArrowRight className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm">
                      Cleanup after data processing
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowRight className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm">Error recovery workflows</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowRight className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm">Multi-stage deployments</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowRight className="text-muted-foreground h-4 w-4" />
                    <span className="text-sm">
                      Conditional processing flows
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Setup */}
        <section id="setup" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">
            Setting Up Conditional Actions
          </h2>

          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Conditional actions are configured in the event form under the
              "Conditional Actions" section. You can add multiple actions with
              different trigger conditions for comprehensive automation.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Configuration Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">
                    1
                  </div>
                  <div>
                    <h4 className="mb-1 font-medium">Choose Trigger Type</h4>
                    <p className="text-muted-foreground text-sm">
                      Select when the action should trigger: On Success, On
                      Failure, Always, or On Condition
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">
                    2
                  </div>
                  <div>
                    <h4 className="mb-1 font-medium">Select Action Type</h4>
                    <p className="text-muted-foreground text-sm">
                      Choose between "Send Message" for notifications or "Run
                      Another Event" for chaining
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">
                    3
                  </div>
                  <div>
                    <h4 className="mb-1 font-medium">
                      Configure Action Details
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      Set up message content and credentials for Send Message,
                      or select target event for Run Another Event
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">
                    4
                  </div>
                  <div>
                    <h4 className="mb-1 font-medium">Add and Test</h4>
                    <p className="text-muted-foreground text-sm">
                      Add the conditional action to your event and test the
                      automation workflow
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Best Practices */}
        <section id="best-practices" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Best Practices</h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-green-600">Do's</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                    <div>
                      <p className="font-medium">Use descriptive templates</p>
                      <p className="text-muted-foreground text-sm">
                        Include event name, status, and relevant context
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                    <div>
                      <p className="font-medium">Test your workflows</p>
                      <p className="text-muted-foreground text-sm">
                        Verify conditional actions work as expected
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                    <div>
                      <p className="font-medium">Use system templates</p>
                      <p className="text-muted-foreground text-sm">
                        Leverage built-in templates for consistency
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-red-600">Don'ts</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
                    <div>
                      <p className="font-medium">Create infinite loops</p>
                      <p className="text-muted-foreground text-sm">
                        Avoid events that trigger themselves
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
                    <div>
                      <p className="font-medium">Ignore error handling</p>
                      <p className="text-muted-foreground text-sm">
                        Always set up failure notifications
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
                    <div>
                      <p className="font-medium">Hardcode values</p>
                      <p className="text-muted-foreground text-sm">
                        Use templates and variables for flexibility
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
