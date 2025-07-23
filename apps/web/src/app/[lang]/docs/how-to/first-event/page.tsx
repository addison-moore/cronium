import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Terminal, Server, Play, AlertCircle } from "lucide-react";

const tableOfContents = [
  { title: "Before You Begin", href: "#before-you-begin", level: 2 },
  { title: "Step 1: Navigate to Events", href: "#step-1-navigate", level: 2 },
  { title: "Step 2: Create New Event", href: "#step-2-create", level: 2 },
  { title: "Step 3: Configure Script", href: "#step-3-configure", level: 2 },
  { title: "Step 4: Test Execution", href: "#step-4-test", level: 2 },
  { title: "Step 5: Set Schedule", href: "#step-5-schedule", level: 2 },
  { title: "Best Practices", href: "#best-practices", level: 2 },
  { title: "Troubleshooting", href: "#troubleshooting", level: 2 },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100">
      <code>{children}</code>
    </pre>
  );
}

function StepCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="mb-2 flex items-center gap-3">
          <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold">
            {step}
          </div>
          <CardTitle className="text-xl">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// Enable Partial Prerendering for this page
export const experimental_ppr = true;

// ISR configuration - revalidate every hour
export const revalidate = 3600; // 1 hour
export const dynamic = "force-static";
export default async function FirstEventPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  return (
    <DocsLayout lang={lang} tableOfContents={tableOfContents}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            >
              Beginner
            </Badge>
            <Badge variant="outline">10 minutes</Badge>
          </div>
          <h1 className="mb-4 text-4xl font-bold">Create Your First Event</h1>
          <p className="text-muted-foreground text-xl">
            Learn how to create and run your first automated script in Cronium.
            This guide walks you through the complete process from setup to
            execution.
          </p>
        </div>

        <section id="before-you-begin" className="mb-12">
          <h2 className="mb-4 text-2xl font-bold">Before You Begin</h2>
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="mt-1 h-5 w-5 text-green-500" />
                  <div>
                    <h4 className="font-semibold">Cronium Account</h4>
                    <p className="text-muted-foreground text-sm">
                      Make sure you have access to a Cronium instance and can
                      sign in to the dashboard.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Server className="mt-1 h-5 w-5 text-blue-500" />
                  <div>
                    <h4 className="font-semibold">
                      Server Connection (Optional)
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      For remote execution, you'll need SSH access to a server.
                      Local execution works without this.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Terminal className="mt-1 h-5 w-5 text-purple-500" />
                  <div>
                    <h4 className="font-semibold">Basic Script Knowledge</h4>
                    <p className="text-muted-foreground text-sm">
                      Familiarity with bash, Python, or Node.js scripts will be
                      helpful but not required.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <StepCard step={1} title="Navigate to Events">
          <div className="space-y-4">
            <p>
              Start by accessing the Events section in your Cronium dashboard.
            </p>
            <ol className="list-inside list-decimal space-y-2 text-sm">
              <li>Sign in to your Cronium dashboard</li>
              <li>
                Click on <strong>"Events"</strong> in the main navigation
              </li>
              <li>
                Click the <strong>"Create Event"</strong> button
              </li>
            </ol>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
              <div className="flex items-start gap-3">
                <Terminal className="mt-1 h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Tip:</strong> If you don't see the "Create Event"
                    button, check that you have the necessary permissions.
                    Contact your administrator if needed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </StepCard>

        <StepCard step={2} title="Create New Event">
          <div className="space-y-4">
            <p>
              Fill in the basic information for your event. Start with something
              simple for your first event.
            </p>

            <div className="space-y-4">
              <div>
                <h4 className="mb-2 font-semibold">Basic Information</h4>
                <div className="bg-muted rounded-lg p-4">
                  <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                    <div>
                      <strong>Event Name:</strong>
                      <br />
                      <code>My First Event</code>
                    </div>
                    <div>
                      <strong>Event Type:</strong>
                      <br />
                      <code>Bash Script</code>
                    </div>
                    <div className="md:col-span-2">
                      <strong>Description:</strong>
                      <br />
                      <code>A simple hello world script to test Cronium</code>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">Event Type Options</h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Card className="border-green-200 dark:border-green-800">
                    <CardContent className="pt-4">
                      <h5 className="font-medium text-green-700 dark:text-green-300">
                        Bash Script
                      </h5>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Best for system administration and file operations
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <h5 className="font-medium">Python Script</h5>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Great for data processing and API integrations
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <h5 className="font-medium">Node.js Script</h5>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Perfect for JavaScript-based automation
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <h5 className="font-medium">HTTP Request</h5>
                      <p className="text-muted-foreground mt-1 text-sm">
                        For webhook calls and API testing
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </StepCard>

        <StepCard step={3} title="Configure Your Script">
          <div className="space-y-4">
            <p>
              Now add the script content. For your first event, we'll create a
              simple script that demonstrates basic functionality.
            </p>

            <div>
              <h4 className="mb-3 font-semibold">Sample Script</h4>
              <p className="text-muted-foreground mb-3 text-sm">
                Copy and paste this script into the script editor:
              </p>
              <CodeBlock>{`#!/bin/bash

# Your first Cronium event
echo "Hello from Cronium!"
echo "Event started at: $(date)"
echo "Running on server: $(hostname)"

# Check current directory
echo "Current directory: $(pwd)"

# Show current user
echo "Running as user: $(whoami)"

# Create a simple log entry
echo "$(date): First event executed successfully" >> /tmp/cronium-first-event.log

# Display system information
echo "System uptime:"
uptime

echo "Event completed successfully!"`}</CodeBlock>
            </div>

            <div>
              <h4 className="mb-2 font-semibold">Script Explanation</h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono">echo</span>
                  <span className="text-muted-foreground">
                    Outputs information to the console
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono">$(date)</span>
                  <span className="text-muted-foreground">
                    Shows the current date and time
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono">$(hostname)</span>
                  <span className="text-muted-foreground">
                    Displays the server name
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono">
                    {">>"} /tmp/...
                  </span>
                  <span className="text-muted-foreground">
                    Writes a log entry to a file
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono">uptime</span>
                  <span className="text-muted-foreground">
                    Shows how long the system has been running
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="mb-2 font-semibold">Server Selection</h4>
              <p className="text-muted-foreground text-sm">
                If you have servers configured, select one from the dropdown. If
                not, you can run this locally or skip server selection for now.
              </p>
            </div>
          </div>
        </StepCard>

        <StepCard step={4} title="Test Your Event">
          <div className="space-y-4">
            <p>
              Before scheduling your event, let's test it to make sure
              everything works correctly.
            </p>

            <div className="space-y-4">
              <div>
                <h4 className="mb-2 font-semibold">1. Save Your Event</h4>
                <p className="text-muted-foreground text-sm">
                  Click <strong>"Save Event"</strong> to store your
                  configuration.
                </p>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">2. Run Test Execution</h4>
                <p className="text-muted-foreground mb-3 text-sm">
                  Click the <strong>"Run Now"</strong> button to execute your
                  event immediately.
                </p>
                <div className="rounded-lg bg-gray-900 p-4 font-mono text-sm text-green-400">
                  <div className="mb-2 flex items-center gap-2">
                    <Play className="h-4 w-4" />
                    <span className="text-white">Execution started...</span>
                  </div>
                  <div>Hello from Cronium!</div>
                  <div>Event started at: Mon Jan 20 2024 14:30:00 GMT</div>
                  <div>Running on server: my-server</div>
                  <div>Current directory: /home/user</div>
                  <div>Running as user: user</div>
                  <div>System uptime: 14:30:42 up 5 days, 2:15, 1 user</div>
                  <div>Event completed successfully!</div>
                  <div className="mt-2 flex items-center gap-2 text-green-500">
                    <CheckCircle className="h-4 w-4" />
                    <span>Execution completed (exit code: 0)</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">3. Review the Results</h4>
                <p className="text-muted-foreground text-sm">
                  Check that the output looks similar to the example above. The
                  exact values will vary based on your server and current time.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <div className="flex items-start gap-3">
                <CheckCircle className="mt-1 h-5 w-5 text-green-500" />
                <div>
                  <p className="text-sm text-green-800 dark:text-green-200">
                    <strong>Success!</strong> If you see output similar to the
                    example, your event is working correctly. You're ready to
                    schedule it for automatic execution.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </StepCard>

        <StepCard step={5} title="Set Up Scheduling">
          <div className="space-y-4">
            <p>
              Now that your event works, let's schedule it to run automatically.
            </p>

            <div className="space-y-4">
              <div>
                <h4 className="mb-2 font-semibold">1. Edit Event Schedule</h4>
                <p className="text-muted-foreground text-sm">
                  Go back to your event and click <strong>"Edit"</strong>, then
                  navigate to the Schedule section.
                </p>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">2. Choose Schedule Type</h4>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Card>
                    <CardContent className="pt-4">
                      <h5 className="mb-2 font-medium">For Testing</h5>
                      <p className="text-muted-foreground mb-2 text-sm">
                        Run every 5 minutes:
                      </p>
                      <code className="bg-muted rounded px-2 py-1">
                        {"*/5 * * * *"}
                      </code>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <h5 className="mb-2 font-medium">For Production</h5>
                      <p className="text-muted-foreground mb-2 text-sm">
                        Run daily at 2 AM:
                      </p>
                      <code className="bg-muted rounded px-2 py-1">
                        {"0 2 * * *"}
                      </code>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">
                  3. Common Schedule Examples
                </h4>
                <div className="bg-muted rounded-lg p-4">
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div>
                      <strong>Every minute:</strong> <code>{"* * * * *"}</code>
                    </div>
                    <div>
                      <strong>Every hour:</strong> <code>{"0 * * * *"}</code>
                    </div>
                    <div>
                      <strong>Every day at midnight:</strong>{" "}
                      <code>{"0 0 * * *"}</code>
                    </div>
                    <div>
                      <strong>Every Monday at 9 AM:</strong>{" "}
                      <code>{"0 9 * * 1"}</code>
                    </div>
                    <div>
                      <strong>First day of month:</strong>{" "}
                      <code>{"0 0 1 * *"}</code>
                    </div>
                    <div>
                      <strong>Every 15 minutes:</strong>{" "}
                      <code>*/15 * * * *</code>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">4. Enable the Event</h4>
                <p className="text-muted-foreground text-sm">
                  Make sure the event status is set to <strong>"Active"</strong>{" "}
                  and save your changes.
                </p>
              </div>
            </div>
          </div>
        </StepCard>

        <section id="best-practices" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Best Practices</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Script Writing</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li>• Always include error handling in your scripts</li>
                  <li>• Use descriptive names for your events</li>
                  <li>• Add comments to explain complex logic</li>
                  <li>• Test scripts manually before scheduling</li>
                  <li>• Use absolute paths for file operations</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Scheduling</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li>• Start with longer intervals for testing</li>
                  <li>• Consider server timezone settings</li>
                  <li>• Avoid scheduling too many events simultaneously</li>
                  <li>• Monitor initial executions closely</li>
                  <li>• Set up notifications for failures</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="troubleshooting" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Troubleshooting</h2>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  Common Issues
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-red-700 dark:text-red-300">
                      Event fails with "Permission denied"
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      Check that your script has execute permissions and that
                      the user has access to required files.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-red-700 dark:text-red-300">
                      Script runs locally but fails on server
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      Verify that all required tools and dependencies are
                      installed on the target server.
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-red-700 dark:text-red-300">
                      Schedule doesn't trigger
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      Ensure the event is set to "Active" status and check the
                      cron expression syntax.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <div className="rounded-lg border border-green-200 bg-gradient-to-r from-green-50 to-blue-50 p-6 dark:border-green-800 dark:from-green-950 dark:to-blue-950">
          <h3 className="mb-2 font-semibold">Congratulations!</h3>
          <p className="text-muted-foreground mb-4 text-sm">
            You've successfully created and scheduled your first Cronium event.
            You now have the foundation to build more complex automation
            workflows.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={`/${lang}/docs/how-to/build-workflow`}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm transition-colors"
            >
              Next: Build a Workflow
            </a>
            <a
              href={`/${lang}/docs/how-to`}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              More How-to Guides
            </a>
          </div>
        </div>
      </div>
    </DocsLayout>
  );
}
