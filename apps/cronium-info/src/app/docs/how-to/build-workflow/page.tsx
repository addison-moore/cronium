import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@cronium/ui";
import {
  Workflow,
  PlusCircle,
  GitBranch,
  PlayCircle,
  CheckCircle,
  Lightbulb,
} from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Build a Workflow",
  description:
    "Step-by-step: chain events together on the Cronium workflow canvas with success, failure, and conditional branches.",
  alternates: { canonical: "/docs/how-to/build-workflow" },
};

const tableOfContents = [
  { title: "Before You Begin", href: "#before-you-begin", level: 2 },
  { title: "Step 1: Open the Workflows Area", href: "#step-1", level: 2 },
  {
    title: "Step 2: Name and Describe the Workflow",
    href: "#step-2",
    level: 2,
  },
  { title: "Step 3: Add Events to the Canvas", href: "#step-3", level: 2 },
  { title: "Step 4: Connect and Configure Edges", href: "#step-4", level: 2 },
  { title: "Step 5: Save and Test", href: "#step-5", level: 2 },
  { title: "Tips & Best Practices", href: "#tips", level: 2 },
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

export default function BuildWorkflowPage() {
  return (
    <DocsLayout tableOfContents={tableOfContents}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="mb-4 text-4xl font-bold">Build a Workflow</h1>
          <p className="text-muted-foreground text-xl">
            Combine multiple events into a single automation that reacts to
            upstream results. You&apos;ll start with an empty canvas, place
            event nodes, configure connections, and trigger a test run.
          </p>
        </div>

        <section id="before-you-begin" className="mb-12">
          <h2 className="mb-4 text-2xl font-bold">Before You Begin</h2>
          <Card>
            <CardContent className="text-muted-foreground space-y-3 pt-6 text-sm">
              <div className="flex items-start gap-3">
                <CheckCircle className="text-success mt-1 h-5 w-5" />
                <p>
                  Create at least two events you want to orchestrate. Workflows
                  reference existing events rather than defining new scripts.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <Workflow className="text-info mt-1 h-5 w-5" />
                <p>
                  Decide how the events should hand off execution—success,
                  failure, or manual triggers.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <Lightbulb className="text-warning mt-1 h-5 w-5" />
                <p>
                  Consider tagging events with a naming convention so you can
                  find them quickly in the workflow builder drawer.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <StepCard step={1} title="Open the Workflows Area" id="step-1">
          <div className="space-y-3">
            <p>
              From the Cronium dashboard sidebar, choose{" "}
              <strong>Workflows</strong>
              and click <strong>Create Workflow</strong>.
            </p>
            <Alert>
              <AlertTitle>Note</AlertTitle>
              <AlertDescription>
                The workflow canvas opens with an empty grid. The panel on the
                right lists the events you can drag into the canvas.
              </AlertDescription>
            </Alert>
          </div>
        </StepCard>

        <StepCard step={2} title="Name and Describe the Workflow" id="step-2">
          <div className="space-y-3">
            <p>
              In the details panel on the left, provide a descriptive name and
              optional summary. The description helps teammates understand the
              automation&apos;s purpose.
            </p>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-950/30">
              <ul className="space-y-1">
                <li>
                  <strong>Trigger type</strong>: choose <em>manual</em> while
                  prototyping. You can switch to <em>schedule</em> or{" "}
                  <em>webhook</em>
                  later.
                </li>
                <li>
                  <strong>Tags</strong>: add labels like “nightly” or “billing”
                  to group workflows in the dashboard list.
                </li>
              </ul>
            </div>
          </div>
        </StepCard>

        <StepCard step={3} title="Add Events to the Canvas" id="step-3">
          <div className="space-y-3">
            <p>
              Drag events from the right-hand drawer onto the grid. Each event
              node represents an existing script execution.
            </p>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <PlusCircle className="text-success h-5 w-5" />
                  Tips for placing nodes
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground space-y-2 text-sm">
                <p>
                  Place the workflow entry point at the top-left, then arrange
                  follow-up actions beneath it.
                </p>
                <p>
                  Use the alignment guides that appear while dragging to keep
                  the layout tidy.
                </p>
              </CardContent>
            </Card>
          </div>
        </StepCard>

        <StepCard step={4} title="Connect and Configure Edges" id="step-4">
          <div className="space-y-3">
            <p>
              Click the small handle on the right side of a node and drag it
              onto the next event. When you release, choose which outcome should
              follow that connection.
            </p>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <GitBranch className="text-primary h-5 w-5" />
                  Edge types
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground space-y-2 text-sm">
                <p>
                  <strong>On success</strong> runs the next event only when the
                  upstream execution finishes successfully.
                </p>
                <p>
                  <strong>On failure</strong> lets you route to a recovery
                  script.
                </p>
                <p>
                  <strong>Always</strong> is useful for notifications that
                  should happen regardless of outcome.
                </p>
              </CardContent>
            </Card>
          </div>
        </StepCard>

        <StepCard step={5} title="Save and Test" id="step-5">
          <div className="space-y-3">
            <p>
              Click <strong>Save Workflow</strong>. Use the{" "}
              <em>Run workflow</em>
              button in the top-right to trigger a manual execution.
            </p>
            <Alert>
              <AlertTitle>Test Run Checklist</AlertTitle>
              <AlertDescription>
                Watch the live execution timeline below the canvas. Each node
                will highlight in real time. If any step fails, open the node
                details to read the captured logs.
              </AlertDescription>
            </Alert>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <PlayCircle className="text-success h-5 w-5" />
                  Promote to schedule (optional)
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground space-y-2 text-sm">
                <p>
                  Once manual tests succeed, switch the trigger type to
                  <em>schedule</em> and pick an interval. Cronium will enqueue
                  the workflow automatically.
                </p>
              </CardContent>
            </Card>
          </div>
        </StepCard>

        <section id="tips" className="mb-16">
          <h2 className="mb-4 text-2xl font-bold">Tips &amp; Best Practices</h2>
          <Card>
            <CardContent className="text-muted-foreground space-y-3 pt-6 text-sm">
              <div className="flex items-start gap-3">
                <Workflow className="text-info mt-1 h-5 w-5" />
                <p>
                  Group related events using tags so you can filter the drawer
                  while building larger workflows.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <Lightbulb className="text-warning mt-1 h-5 w-5" />
                <p>
                  Add notification nodes off the failure path so you are alerted
                  when remediation is required.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle className="text-success mt-1 h-5 w-5" />
                <p>
                  Review workflow run history in the <strong>Logs</strong>{" "}
                  section to confirm downstream scripts behave as expected over
                  time.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </DocsLayout>
  );
}
