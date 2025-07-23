import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  FileText,
  BookOpen,
  Code,
  Terminal,
  Server,
  Shield,
  Clock,
  Database,
} from "lucide-react";
import DocsLayout from "@/components/docs/docs-layout";

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
      className="group hover:border-primary dark:hover:border-primary block rounded-lg border border-gray-200 bg-white p-6 transition-colors dark:border-slate-700 dark:bg-slate-800"
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

export default async function DocsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  return (
    <DocsLayout lang={lang}>
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
              href={`/${lang}/docs/quick-start`}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-md px-6 py-3 transition-colors"
            >
              <BookOpen className="h-5 w-5" />
              Quick Start
            </Link>
            <Link
              href={`/${lang}/docs/api`}
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
              title="Quick Start"
              description="Get up and running with Cronium in minutes"
              icon={BookOpen}
              link={`/${lang}/docs/quick-start`}
            />

            <DocSection
              title="Features"
              description="Explore all the powerful features Cronium offers"
              icon={FileText}
              link={`/${lang}/docs/features`}
            />

            <DocSection
              title="Events & Scripts"
              description="Create and manage automated events and scripts"
              icon={Clock}
              link={`/${lang}/docs/events`}
            />

            <DocSection
              title="Workflows"
              description="Build complex automation workflows with multiple steps"
              icon={Terminal}
              link={`/${lang}/docs/workflows`}
            />

            <DocSection
              title="Unified Input/Output"
              description="Pass data between events and workflows across Python, Node.js, and Bash"
              icon={Database}
              link={`/${lang}/docs/unified-io`}
            />

            <DocSection
              title="Conditional Actions"
              description="Automate responses to event outcomes with powerful conditional actions"
              icon={Clock}
              link={`/${lang}/docs/conditional-actions`}
            />

            <DocSection
              title="Tools"
              description="Configure communication tools and manage credentials for automated notifications"
              icon={FileText}
              link={`/${lang}/docs/tools`}
            />

            <DocSection
              title="Templates"
              description="Create dynamic message templates with Handlebars syntax and runtime variables"
              icon={FileText}
              link={`/${lang}/docs/templates`}
            />

            <DocSection
              title="Remote Execution"
              description="Execute scripts on remote servers via SSH"
              icon={Server}
              link={`/${lang}/docs/remote-execution`}
            />

            <DocSection
              title="Security"
              description="Learn about Cronium's security features and best practices"
              icon={Shield}
              link={`/${lang}/docs/security`}
            />

            <DocSection
              title="API Reference"
              description="Complete API documentation with examples"
              icon={Terminal}
              link={`/${lang}/docs/api`}
            />

            <DocSection
              title="How-to Guides"
              description="Step-by-step guides for common tasks"
              icon={FileText}
              link={`/${lang}/docs/how-to`}
            />
          </div>
        </div>
      </div>
    </DocsLayout>
  );
}
