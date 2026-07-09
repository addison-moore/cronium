import React from "react";
import Link from "next/link";
import DocsLayout from "@/components/docs/docs-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import { ArrowRight, Terminal, Server, Workflow } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How-To Guides",
  description:
    "Step-by-step Cronium guides: create your first event, connect a remote server over SSH, and build a multi-step workflow.",
  alternates: { canonical: "/docs/how-to" },
};

const tableOfContents = [
  { title: "Essential Guides", href: "#essential-guides", level: 2 },
];

function GuideCard({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link href={href} className="group block">
      <Card className="hover:border-primary/60 h-full transition-all duration-200 hover:shadow-md">
        <CardHeader>
          <div className="mb-3 flex items-start">
            <div className="bg-primary/10 rounded-lg p-2">
              <Icon className="text-primary h-5 w-5" />
            </div>
          </div>
          <CardTitle className="group-hover:text-primary text-lg transition-colors">
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-end">
          <ArrowRight className="text-muted-foreground group-hover:text-primary h-4 w-4 transition-colors" />
        </CardContent>
      </Card>
    </Link>
  );
}

export const experimental_ppr = true;
export const revalidate = 3600;
export const dynamic = "force-static";

export default function HowToPage() {
  return (
    <DocsLayout tableOfContents={tableOfContents}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-12">
          <h1 className="mb-4 text-4xl font-bold">How-to Guides</h1>
          <p className="text-muted-foreground text-xl">
            Follow focused walkthroughs that show you how to complete the most
            common setup tasks inside the Cronium dashboard.
          </p>
        </div>

        <section id="essential-guides" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Essential Guides</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <GuideCard
              icon={Terminal}
              title="Create Your First Event"
              description="Build and run your first automated script from the dashboard"
              href="/docs/how-to/first-event"
            />

            <GuideCard
              icon={Server}
              title="Connect a Server"
              description="Add an SSH target and verify credentials for remote execution"
              href="/docs/how-to/connect-server"
            />

            <GuideCard
              icon={Workflow}
              title="Build a Workflow"
              description="Link multiple events together into a reusable automation"
              href="/docs/how-to/build-workflow"
            />
          </div>
        </section>
      </div>
    </DocsLayout>
  );
}
