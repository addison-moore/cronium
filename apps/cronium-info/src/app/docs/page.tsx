import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  FileText,
  BookOpen,
  Code,
  Terminal,
  Server,
  Clock,
  Database,
  Workflow,
  Activity,
} from "lucide-react";
import DocsLayout from "@/components/docs/docs-layout";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Cronium Documentation — Self-Hosting, Workflows & API" },
  description:
    "Official Cronium documentation: self-host with Docker, schedule scripts, build multi-step workflows, connect remote servers, and use the REST API.",
  alternates: { canonical: "/docs" },
};

// Enable Partial Prerendering for this page
export const experimental_ppr = true;

// ISR configuration - revalidate every hour
export const revalidate = 3600; // 1 hour
export const dynamic = "force-static";

// Documentation section component
function DocSection({
  title,
  description,
  icon: Icon,
  link,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  link: string;
}) {
  return (
    <Link
      href={link}
      className="group hover:border-primary dark:hover:border-primary border-border bg-card block rounded-lg border p-6 transition-colors"
    >
      <div className="flex items-start space-x-4">
        <div className="flex-shrink-0">
          <Icon className="text-primary group-hover:text-primary/80 h-8 w-8" />
        </div>
        <div className="flex-grow">
          <h3 className="group-hover:text-primary mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h3>
          <p className="mb-4 text-gray-600 dark:text-gray-400">{description}</p>
          <div className="text-primary group-hover:text-primary/80 flex items-center">
            <span className="text-sm font-medium">Learn more</span>
            <ArrowRight className="ml-2 h-4 w-4" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function DocsPage() {
  return (
    <DocsLayout>
      <div className="mx-auto max-w-4xl">
        {/* Header Section */}
        <div className="mb-12">
          <h1 className="mb-4 text-4xl font-bold tracking-tight">
            Documentation
          </h1>
          <p className="text-muted-foreground mb-8 text-xl">
            Learn how to use Cronium to automate your scripts and workflows
          </p>
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <Link
              href={`/docs/quick-start`}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-md px-6 py-3 transition-colors"
            >
              <BookOpen className="h-5 w-5" />
              Quick Start
            </Link>
            <Link
              href={`/docs/api`}
              className="bg-muted text-foreground hover:bg-muted/70 flex items-center gap-2 rounded-md px-6 py-3 transition-colors"
            >
              <Code className="h-5 w-5" />
              API Reference
            </Link>
          </div>
        </div>

        {/* Documentation Sections */}
        <div className="mb-16">
          <h2 className="mb-8 text-3xl font-bold">Documentation</h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <DocSection
              title="Self-Hosting"
              description="Install Cronium with Docker Compose and GitHub Container Registry"
              icon={Server}
              link={`/docs/self-hosting`}
            />

            <DocSection
              title="Quick Start"
              description="Get up and running with Cronium in minutes"
              icon={BookOpen}
              link={`/docs/quick-start`}
            />

            <DocSection
              title="Features"
              description="Explore the core capabilities of Cronium"
              icon={FileText}
              link={`/docs/features`}
            />

            <DocSection
              title="Runtime Helpers"
              description="Interact with Cronium from your scripts with helper utilities"
              icon={Terminal}
              link={`/docs/runtime-helpers`}
            />

            <DocSection
              title="Unified Input/Output"
              description="Exchange data between events and workflows across languages"
              icon={Database}
              link={`/docs/unified-io`}
            />

            <DocSection
              title="Conditional Actions"
              description="Respond to success, failure, or custom conditions"
              icon={Clock}
              link={`/docs/conditional-actions`}
            />

            <DocSection
              title="Workflows"
              description="Design multi-step automation flows"
              icon={Workflow}
              link={`/docs/features`}
            />

            <DocSection
              title="Tools"
              description="Integrate Slack, email, and other messaging providers"
              icon={FileText}
              link={`/docs/tools`}
            />

            <DocSection
              title="Templates"
              description="Build reusable message templates"
              icon={FileText}
              link={`/docs/templates`}
            />

            <DocSection
              title="API Reference"
              description="REST endpoints with request and response examples"
              icon={Code}
              link={`/docs/api`}
            />

            <DocSection
              title="How-to Guides"
              description="Step-by-step tutorials for common tasks"
              icon={Activity}
              link={`/docs/how-to`}
            />
          </div>
        </div>
      </div>
    </DocsLayout>
  );
}
