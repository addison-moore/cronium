import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@cronium/ui";
import {
  Server,
  Key,
  ShieldCheck,
  CheckCircle,
  Terminal,
  Lock,
} from "lucide-react";

const tableOfContents = [
  { title: "Before You Begin", href: "#before-you-begin", level: 2 },
  { title: "Step 1: Open the Servers Page", href: "#step-1", level: 2 },
  { title: "Step 2: Provide Connection Details", href: "#step-2", level: 2 },
  { title: "Step 3: Choose Authentication", href: "#step-3", level: 2 },
  { title: "Step 4: Test & Save", href: "#step-4", level: 2 },
  { title: "Next Steps", href: "#next-steps", level: 2 },
];

function StepCard({
  step,
  title,
  children,
  id,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section id={id} className="mb-10">
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-3">
            <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold">
              {step}
            </div>
            <CardTitle className="text-xl">{title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </section>
  );
}

export const experimental_ppr = true;
export const revalidate = 3600;
export const dynamic = "force-static";

export default function ConnectServerPage() {
  return (
    <DocsLayout tableOfContents={tableOfContents}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="mb-4 text-4xl font-bold">Connect a Server</h1>
          <p className="text-muted-foreground text-xl">
            Add an SSH server to Cronium so your events can execute scripts on
            remote infrastructure. This guide walks through configuring host
            access, verifying credentials, and saving the connection in the
            dashboard.
          </p>
        </div>

        <section id="before-you-begin" className="mb-12">
          <h2 className="mb-4 text-2xl font-bold">Before You Begin</h2>
          <Card>
            <CardContent className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-2">
              <div className="flex items-start gap-3">
                <CheckCircle className="mt-1 h-5 w-5 text-green-500" />
                <div>
                  <h4 className="font-semibold">SSH Access</h4>
                  <p className="text-muted-foreground text-sm">
                    Ensure the orchestrator host can reach the target server on
                    port 22 (or your custom SSH port).
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Key className="mt-1 h-5 w-5 text-blue-500" />
                <div>
                  <h4 className="font-semibold">Credentials</h4>
                  <p className="text-muted-foreground text-sm">
                    Prepare an SSH private key or password for a user with
                    execution permissions.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <StepCard step={1} title="Open the Servers Area" id="step-1">
          <div className="space-y-3">
            <ol className="list-inside list-decimal space-y-2 text-sm">
              <li>Sign in to the Cronium dashboard.</li>
              <li>
                Use the left navigation to choose <strong>Servers</strong>.
              </li>
              <li>
                Click the <strong>Add Server</strong> button in the top-right
                corner.
              </li>
            </ol>
            <Alert>
              <AlertTitle>Tip</AlertTitle>
              <AlertDescription>
                If you don&apos;t see the <strong>Add Server</strong> button,
                verify your account has admin or maintainer permissions.
              </AlertDescription>
            </Alert>
          </div>
        </StepCard>

        <StepCard step={2} title="Provide Connection Details" id="step-2">
          <div className="space-y-3">
            <p>
              Fill out the server form with information Cronium uses to reach
              your host.
            </p>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-950/30">
              <ul className="space-y-1">
                <li>
                  <strong>Server name</strong>: a friendly label displayed in
                  the UI.
                </li>
                <li>
                  <strong>Address</strong>: hostname or IP address reachable
                  from the orchestrator container.
                </li>
                <li>
                  <strong>Username</strong>: Linux user Cronium should log in
                  as.
                </li>
                <li>
                  <strong>Port</strong>: defaults to 22; update if the server
                  uses a custom SSH port.
                </li>
              </ul>
            </div>
          </div>
        </StepCard>

        <StepCard step={3} title="Choose Authentication" id="step-3">
          <div className="space-y-4">
            <p>
              Pick an authentication method that matches your server policy.
            </p>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Key className="h-5 w-5 text-blue-500" />
                  SSH Private Key
                </CardTitle>
                <CardDescription>
                  Recommended for long-lived automation accounts
                </CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground space-y-2 text-sm">
                <p>
                  Paste the private key contents (PEM format) into the field.
                </p>
                <p>
                  Optionally supply a passphrase if the key is encrypted.
                  Cronium stores the key encrypted using the platform encryption
                  key.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Lock className="h-5 w-5 text-amber-500" />
                  Password Authentication
                </CardTitle>
                <CardDescription>
                  Suitable for temporary or test environments
                </CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground space-y-2 text-sm">
                <p>
                  Enter the SSH password for the account. Consider switching to
                  key based auth for production usage.
                </p>
              </CardContent>
            </Card>
            <Alert>
              <AlertTitle>Security Reminder</AlertTitle>
              <AlertDescription>
                Use dedicated automation accounts with limited privileges.
                Rotate keys regularly and disable password auth if your policy
                allows.
              </AlertDescription>
            </Alert>
          </div>
        </StepCard>

        <StepCard step={4} title="Test &amp; Save" id="step-4">
          <div className="space-y-3">
            <p>
              Click <strong>Test Connection</strong>. Cronium opens an SSH
              session and checks that the account can create a working directory
              on the host.
            </p>
            <ul className="text-muted-foreground list-disc space-y-2 pl-6 text-sm">
              <li>
                If the test succeeds you&apos;ll see a green confirmation
                banner.
              </li>
              <li>
                If the test fails review the error message (DNS resolution,
                firewall, or authentication issues are the most common causes).
              </li>
            </ul>
            <p>
              Once the test passes, click <strong>Save Server</strong>. The
              server is now available in the event editor under the “Remote
              execution” options.
            </p>
          </div>
        </StepCard>

        <section id="next-steps" className="mb-16">
          <h2 className="mb-4 text-2xl font-bold">Next Steps</h2>
          <Card>
            <CardContent className="text-muted-foreground space-y-3 pt-6 text-sm">
              <div className="flex items-start gap-3">
                <Terminal className="mt-1 h-5 w-5 text-blue-500" />
                <p>
                  Run a simple test event that targets your new server to
                  confirm command output is streaming back to Cronium.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-1 h-5 w-5 text-purple-500" />
                <p>
                  Review server permissions periodically and remove credentials
                  for hosts you no longer need.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <Server className="mt-1 h-5 w-5 text-green-500" />
                <p>
                  Need to manage multiple targets? Tag servers so you can filter
                  them quickly when building workflows.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </DocsLayout>
  );
}
