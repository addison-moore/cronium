import React from "react";
import Link from "next/link";
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
  ArrowRight,
  Server,
  Terminal,
  Workflow,
  Shield,
  Clock,
  AlertTriangle,
  Zap,
  Database,
  Settings,
  GitFork,
  SquareActivity,
} from "lucide-react";

const tableOfContents = [
  { title: "Getting Started", href: "#getting-started", level: 2 },
  { title: "Server Management", href: "#server-management", level: 2 },
  { title: "Event Creation", href: "#event-creation", level: 2 },
  { title: "Workflow Building", href: "#workflow-building", level: 2 },
  { title: "Monitoring & Debugging", href: "#monitoring-debugging", level: 2 },
  { title: "Advanced Topics", href: "#advanced-topics", level: 2 },
];

function GuideCard({
  icon: Icon,
  title,
  description,
  href,
  difficulty,
  duration,
  iconClassName,
}: {
  icon: any;
  title: string;
  description: string;
  href: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  duration: string;
  iconClassName?: string;
}) {
  const difficultyColors = {
    Beginner:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    Intermediate:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    Advanced: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  return (
    <Link href={href} className="group block">
      <Card className="h-full transition-all duration-200 hover:shadow-md hover:border-primary/50">
        <CardHeader>
          <div className="flex items-start justify-between mb-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Icon className={`h-5 w-5 text-primary ${iconClassName}`} />
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className={difficultyColors[difficulty]}>
                {difficulty}
              </Badge>
            </div>
          </div>
          <CardTitle className="text-lg group-hover:text-primary transition-colors">
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{duration}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function GuideSection({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section id={id} className="mb-12">
      <h2 className="text-2xl font-bold mb-6">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {children}
      </div>
    </section>
  );
}

export default async function HowToPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  return (
    <DocsLayout lang={lang} tableOfContents={tableOfContents}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-4">How-to Guides</h1>
          <p className="text-xl text-muted-foreground">
            Step-by-step guides to help you accomplish specific tasks with
            Cronium. Each guide includes practical examples and best practices.
          </p>
        </div>

        <GuideSection title="Getting Started" id="getting-started">
          <GuideCard
            icon={Server}
            title="Create Your First Event"
            description="Learn how to create and run your first automated script"
            href={`/${lang}/docs/how-to/first-event`}
            difficulty="Beginner"
            duration="10 min"
          />

          <GuideCard
            icon={Terminal}
            title="Set Up SSH Connection"
            description="Configure secure SSH connections to your servers"
            href={`/${lang}/docs/how-to/ssh-setup`}
            difficulty="Beginner"
            duration="15 min"
          />

          <GuideCard
            icon={Clock}
            title="Schedule Events"
            description="Set up automated scheduling with cron expressions"
            href={`/${lang}/docs/how-to/schedule-events`}
            difficulty="Beginner"
            duration="8 min"
          />
        </GuideSection>

        <GuideSection title="Server Management" id="server-management">
          <GuideCard
            icon={Server}
            title="Manage Multiple Servers"
            description="Configure and organize multiple server connections"
            href={`/${lang}/docs/how-to/multiple-servers`}
            difficulty="Intermediate"
            duration="20 min"
          />

          <GuideCard
            icon={Shield}
            title="Secure Server Access"
            description="Implement security best practices for server connections"
            href={`/${lang}/docs/how-to/secure-access`}
            difficulty="Intermediate"
            duration="25 min"
          />

          <GuideCard
            icon={SquareActivity}
            title="Monitor Server Health"
            description="Set up automated server health monitoring"
            href={`/${lang}/docs/how-to/server-health`}
            difficulty="Intermediate"
            duration="18 min"
          />
        </GuideSection>

        <GuideSection title="Event Creation" id="event-creation">
          <GuideCard
            icon={Terminal}
            title="Write Effective Scripts"
            description="Best practices for writing maintainable automation scripts"
            href={`/${lang}/docs/how-to/effective-scripts`}
            difficulty="Intermediate"
            duration="30 min"
          />

          <GuideCard
            icon={Settings}
            title="Use Environment Variables"
            description="Manage configuration with environment variables"
            href={`/${lang}/docs/how-to/environment-variables`}
            difficulty="Beginner"
            duration="12 min"
          />

          <GuideCard
            icon={AlertTriangle}
            title="Handle Errors Gracefully"
            description="Implement robust error handling in your scripts"
            href={`/${lang}/docs/how-to/error-handling`}
            difficulty="Intermediate"
            duration="22 min"
          />
        </GuideSection>

        <GuideSection title="Workflow Building" id="workflow-building">
          <GuideCard
            icon={Workflow}
            title="Build a Workflow"
            description="Create complex automation workflows with multiple steps"
            href={`/${lang}/docs/how-to/build-workflow`}
            difficulty="Intermediate"
            duration="35 min"
          />

          <GuideCard
            icon={GitFork}
            title="Conditional Logic"
            description="Add conditional logic and branching to workflows"
            href={`/${lang}/docs/how-to/conditional-logic`}
            difficulty="Advanced"
            duration="28 min"
            iconClassName="rotate-90"
          />

          <GuideCard
            icon={Zap}
            title="Parallel Execution"
            description="Run multiple tasks simultaneously in workflows"
            href={`/${lang}/docs/how-to/parallel-execution`}
            difficulty="Advanced"
            duration="25 min"
          />
        </GuideSection>

        <GuideSection title="Monitoring & Debugging" id="monitoring-debugging">
          <GuideCard
            icon={SquareActivity}
            title="Monitor Performance"
            description="Track and analyze the performance of your automations"
            href={`/${lang}/docs/how-to/monitor-performance`}
            difficulty="Intermediate"
            duration="20 min"
          />

          <GuideCard
            icon={AlertTriangle}
            title="Troubleshooting"
            description="Debug common issues and resolve problems"
            href={`/${lang}/docs/how-to/troubleshooting`}
            difficulty="Intermediate"
            duration="30 min"
          />

          <GuideCard
            icon={Database}
            title="Analyze Execution Logs"
            description="Use logs effectively for debugging and optimization"
            href={`/${lang}/docs/how-to/analyze-logs`}
            difficulty="Beginner"
            duration="15 min"
          />
        </GuideSection>

        <GuideSection title="Advanced Topics" id="advanced-topics">
          <GuideCard
            icon={Shield}
            title="Deploy to Production"
            description="Best practices for production deployment"
            href={`/${lang}/docs/how-to/deploy-production`}
            difficulty="Advanced"
            duration="45 min"
          />

          <GuideCard
            icon={Settings}
            title="API Integration"
            description="Integrate Cronium with external systems using the API"
            href={`/${lang}/docs/how-to/api-integration`}
            difficulty="Advanced"
            duration="40 min"
          />

          <GuideCard
            icon={Database}
            title="Backup and Recovery"
            description="Implement backup strategies and disaster recovery"
            href={`/${lang}/docs/how-to/backup-recovery`}
            difficulty="Advanced"
            duration="35 min"
          />
        </GuideSection>

        <div className="mt-16 bg-muted/50 border border-muted rounded-lg p-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">
              Can't Find What You're Looking For?
            </h2>
            <p className="text-muted-foreground mb-6">
              These guides cover the most common use cases. For specific
              questions or advanced scenarios, check out our comprehensive API
              documentation or browse our other resources.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link
                href={`/${lang}/docs/api`}
                className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                API Documentation
              </Link>
              <Link
                href={`/${lang}/docs/features`}
                className="inline-flex items-center justify-center px-6 py-3 bg-muted text-foreground border border-border rounded-md hover:bg-muted/80 transition-colors"
              >
                Feature Overview
              </Link>
            </div>
          </div>
        </div>
      </div>
    </DocsLayout>
  );
}
