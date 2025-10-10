import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import {
  CheckCircle,
  ArrowRight,
  Terminal,
  Server,
  Clock,
  Play,
} from "lucide-react";

const tableOfContents = [
  { title: "Prerequisites", href: "#prerequisites", level: 2 },
  { title: "Step 1: Sign In", href: "#step-1-sign-in", level: 2 },
  {
    title: "Step 2: Add Your First Server",
    href: "#step-2-add-server",
    level: 2,
  },
  {
    title: "Step 3: Create Your First Event",
    href: "#step-3-create-event",
    level: 2,
  },
  { title: "Step 4: Test Your Event", href: "#step-4-test-event", level: 2 },
  {
    title: "Step 5: Schedule Your Event",
    href: "#step-5-schedule-event",
    level: 2,
  },
  { title: "Next Steps", href: "#next-steps", level: 2 },
];

function StepCard({
  step,
  title,
  description,
  children,
  completed = false,
}: {
  step: number;
  title: string;
  description: string;
  children: React.ReactNode;
  completed?: boolean;
}) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="mb-2 flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
              completed
                ? "bg-green-500 text-white"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {completed ? <CheckCircle className="h-5 w-5" /> : step}
          </div>
          <div>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function CodeBlock({
  children,
  _language = "bash",
}: {
  children: string;
  _language?: string;
}) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100">
      <code>{children}</code>
    </pre>
  );
}

// Enable Partial Prerendering for this page
export const experimental_ppr = true;

// ISR configuration - revalidate every hour
export const revalidate = 3600; // 1 hour
export const dynamic = "force-static";
export default function QuickStartPage() {
  return (
    <DocsLayout tableOfContents={tableOfContents}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="mb-4 text-4xl font-bold">Quick Start Guide</h1>
          <p className="text-muted-foreground text-xl">
            Get up and running with Cronium in just a few minutes. This guide
            will walk you through creating your first automated script.
          </p>
        </div>

        <div className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
          <h3 className="mb-2 font-semibold text-blue-900 dark:text-blue-100">
            Estimated Time: 10 minutes
          </h3>
          <p className="text-sm text-blue-800 dark:text-blue-200">
            By the end of this guide, you'll have a working automated script
            that runs on a schedule.
          </p>
        </div>

        <section id="prerequisites" className="mb-12">
          <h2 className="mb-4 text-2xl font-bold">Prerequisites</h2>
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex items-start gap-3">
                  <CheckCircle className="mt-1 h-5 w-5 text-green-500" />
                  <div>
                    <h4 className="font-semibold">Cronium Account</h4>
                    <p className="text-muted-foreground text-sm">
                      You'll need a Cronium account to get started.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Server className="mt-1 h-5 w-5 text-blue-500" />
                  <div>
                    <h4 className="font-semibold">Server Access (Optional)</h4>
                    <p className="text-muted-foreground text-sm">
                      SSH access to a server for remote execution.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <StepCard
          step={1}
          title="Sign In to Cronium"
          description="Access your Cronium dashboard"
        >
          <div className="space-y-4">
            <p>
              Navigate to your Cronium instance and sign in with your
              credentials. If you don't have an account yet, you can create one
              using the sign-up form.
            </p>
            <div className="bg-muted rounded-lg p-4">
              <p className="text-sm">
                <strong>Tip:</strong> Make sure to verify your email address if
                this is your first time signing in.
              </p>
            </div>
          </div>
        </StepCard>

        <StepCard
          step={2}
          title="Add Your First Server"
          description="Configure a server for remote script execution"
        >
          <div className="space-y-4">
            <p>
              Before creating events, you'll need to add at least one server
              where your scripts can run.
            </p>

            <div className="space-y-3">
              <div>
                <h4 className="mb-2 font-semibold">1. Navigate to Servers</h4>
                <p className="text-muted-foreground text-sm">
                  Go to <strong>Dashboard → Servers → Add Server</strong>
                </p>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">2. Enter Server Details</h4>
                <div className="bg-muted rounded-lg p-4">
                  <ul className="space-y-2 text-sm">
                    <li>
                      <strong>Name:</strong> My Production Server
                    </li>
                    <li>
                      <strong>Address:</strong> your-server.com
                    </li>
                    <li>
                      <strong>Username:</strong> root (or your SSH username)
                    </li>
                    <li>
                      <strong>Port:</strong> 22 (default SSH port)
                    </li>
                  </ul>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">3. Add SSH Key</h4>
                <p className="text-muted-foreground mb-2 text-sm">
                  Paste your private SSH key or generate a new key pair:
                </p>
                <CodeBlock>{`# Generate a new SSH key pair
ssh-keygen -t rsa -b 4096 -C "cronium@yourserver"

# Copy your public key to the server
ssh-copy-id user@your-server.com`}</CodeBlock>
              </div>
            </div>

            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Security Note:</strong> Your SSH keys are encrypted and
                stored securely. Cronium uses industry-standard encryption to
                protect your credentials.
              </p>
            </div>
          </div>
        </StepCard>

        <StepCard
          step={3}
          title="Create Your First Event"
          description="Set up an automated script"
        >
          <div className="space-y-4">
            <p>
              Now let's create a simple event that will run a basic script on
              your server.
            </p>

            <div className="space-y-3">
              <div>
                <h4 className="mb-2 font-semibold">1. Create New Event</h4>
                <p className="text-muted-foreground text-sm">
                  Go to <strong>Dashboard → Events → Create Event</strong>
                </p>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">2. Basic Information</h4>
                <div className="bg-muted rounded-lg p-4">
                  <ul className="space-y-2 text-sm">
                    <li>
                      <strong>Name:</strong> My First Script
                    </li>
                    <li>
                      <strong>Description:</strong> A simple hello world script
                    </li>
                    <li>
                      <strong>Type:</strong> Bash Script
                    </li>
                  </ul>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">3. Script Content</h4>
                <p className="text-muted-foreground mb-2 text-sm">
                  Add this simple script:
                </p>
                <CodeBlock>{`#!/bin/bash

# Simple hello world script
echo "Hello from Cronium!"
echo "Current date: $(date)"
echo "Server hostname: $(hostname)"

# Create a log file
echo "Script executed at $(date)" >> /tmp/cronium-test.log

# Show system information
echo "System uptime:"
uptime`}</CodeBlock>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">4. Select Server</h4>
                <p className="text-muted-foreground text-sm">
                  Choose the server you added in the previous step.
                </p>
              </div>
            </div>
          </div>
        </StepCard>

        <StepCard
          step={4}
          title="Test Your Event"
          description="Run your script manually to ensure it works"
        >
          <div className="space-y-4">
            <p>
              Before scheduling your event, let's test it to make sure
              everything works correctly.
            </p>

            <div className="space-y-3">
              <div>
                <h4 className="mb-2 font-semibold">1. Run Test Execution</h4>
                <p className="text-muted-foreground text-sm">
                  Click the <strong>"Run Now"</strong> button next to your
                  event.
                </p>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">2. Monitor Execution</h4>
                <p className="text-muted-foreground mb-2 text-sm">
                  Watch the real-time logs as your script executes:
                </p>
                <div className="rounded-lg bg-gray-900 p-4 font-mono text-sm text-green-400">
                  <div className="mb-2 flex items-center gap-2">
                    <Play className="h-4 w-4" />
                    <span>Execution started...</span>
                  </div>
                  <div>Hello from Cronium!</div>
                  <div>Current date: Mon Jan 20 2024 14:30:00</div>
                  <div>Server hostname: production-server</div>
                  <div>System uptime: 15:30:42 up 5 days, 2:15</div>
                  <div className="mt-2 flex items-center gap-2 text-green-500">
                    <CheckCircle className="h-4 w-4" />
                    <span>Execution completed successfully</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">3. Review Results</h4>
                <p className="text-muted-foreground text-sm">
                  Check the execution logs and verify that your script ran
                  without errors.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <p className="text-sm text-green-800 dark:text-green-200">
                <strong>Success!</strong> If you see the output above, your
                event is working correctly and ready to be scheduled.
              </p>
            </div>
          </div>
        </StepCard>

        <StepCard
          step={5}
          title="Schedule Your Event"
          description="Set up automatic execution"
        >
          <div className="space-y-4">
            <p>
              Now that your event is working, let's schedule it to run
              automatically.
            </p>

            <div className="space-y-3">
              <div>
                <h4 className="mb-2 font-semibold">1. Edit Event Schedule</h4>
                <p className="text-muted-foreground text-sm">
                  Click <strong>"Edit"</strong> on your event and navigate to
                  the Schedule section.
                </p>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">2. Set Schedule</h4>
                <p className="text-muted-foreground mb-2 text-sm">
                  Choose when you want your script to run. Here are some common
                  examples:
                </p>
                <div className="bg-muted rounded-lg p-4">
                  <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div>
                      <strong>Every minute:</strong> <code>* * * * *</code>
                    </div>
                    <div>
                      <strong>Every hour:</strong> <code>0 * * * *</code>
                    </div>
                    <div>
                      <strong>Daily at 2 AM:</strong> <code>0 2 * * *</code>
                    </div>
                    <div>
                      <strong>Weekly (Mondays):</strong> <code>0 0 * * 1</code>
                    </div>
                  </div>
                </div>
                <p className="text-muted-foreground mt-2 text-sm">
                  For testing, let's use <code>*/5 * * * *</code> to run every 5
                  minutes.
                </p>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">3. Enable Event</h4>
                <p className="text-muted-foreground text-sm">
                  Make sure the event is set to <strong>"Active"</strong>{" "}
                  status.
                </p>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">4. Save Changes</h4>
                <p className="text-muted-foreground text-sm">
                  Click <strong>"Save Event"</strong> to activate the schedule.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
              <div className="flex items-start gap-3">
                <Clock className="mt-1 h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Congratulations!</strong> Your event is now
                    scheduled and will run automatically. You can monitor its
                    execution in the Events dashboard.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </StepCard>

        <section id="next-steps" className="mb-12">
          <h2 className="mb-4 text-2xl font-bold">Next Steps</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="h-5 w-5" />
                  Explore More Features
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3 text-sm">
                  Learn about advanced features like workflows, environment
                  variables, and monitoring.
                </p>
                <a
                  href={`/docs/features`}
                  className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                >
                  View Features Guide <ArrowRight className="h-4 w-4" />
                </a>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  Build Workflows
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3 text-sm">
                  Create complex automation workflows with multiple events and
                  conditional logic.
                </p>
                <a
                  href={`/docs/workflows`}
                  className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                >
                  Learn Workflows <ArrowRight className="h-4 w-4" />
                </a>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  API Integration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3 text-sm">
                  Integrate Cronium with your applications using our
                  comprehensive API.
                </p>
                <a
                  href={`/docs/api`}
                  className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                >
                  View API Docs <ArrowRight className="h-4 w-4" />
                </a>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  How-to Guides
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3 text-sm">
                  Step-by-step guides for common tasks and advanced use cases.
                </p>
                <a
                  href={`/docs/how-to`}
                  className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                >
                  Browse Guides <ArrowRight className="h-4 w-4" />
                </a>
              </CardContent>
            </Card>
          </div>
        </section>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-gray-900">
          <h3 className="mb-2 font-semibold">Need Help?</h3>
          <p className="text-muted-foreground mb-3 text-sm">
            If you run into any issues or have questions, here are some
            resources:
          </p>
          <ul className="space-y-1 text-sm">
            <li>
              • Check the{" "}
              <a
                href={`/docs/how-to/troubleshooting`}
                className="text-primary hover:underline"
              >
                Troubleshooting Guide
              </a>
            </li>
            <li>
              • Review the{" "}
              <a href={`/docs/api`} className="text-primary hover:underline">
                API Documentation
              </a>
            </li>
            <li>
              • Browse{" "}
              <a href={`/docs/how-to`} className="text-primary hover:underline">
                How-to Guides
              </a>
            </li>
          </ul>
        </div>
      </div>
    </DocsLayout>
  );
}
