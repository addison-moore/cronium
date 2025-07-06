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
  Terminal,
  Server,
  Clock,
  Workflow,
  Shield,
  Eye,
  Zap,
  Database,
  Bell,
  Lock,
  Activity,
  GitFork,
} from "lucide-react";

const tableOfContents = [
  { title: "Script Automation", href: "#script-automation", level: 2 },
  { title: "Remote Execution", href: "#remote-execution", level: 2 },
  { title: "Workflow Engine", href: "#workflow-engine", level: 2 },
  { title: "Scheduling System", href: "#scheduling-system", level: 2 },
  { title: "Real-time Monitoring", href: "#real-time-monitoring", level: 2 },
  { title: "Security Features", href: "#security-features", level: 2 },
  { title: "API Integration", href: "#api-integration", level: 2 },
  {
    title: "Environment Management",
    href: "#environment-management",
    level: 2,
  },
  { title: "Notification System", href: "#notification-system", level: 2 },
  { title: "Role-Based Access", href: "#role-based-access", level: 2 },
];

function FeatureCard({
  icon: Icon,
  title,
  description,
  features,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  features: string[];
  badge?: string;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="mb-2 flex items-center gap-3">
          <div className="bg-primary/10 rounded-lg p-2">
            <Icon className="text-primary h-6 w-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{title}</CardTitle>
              {badge && <Badge variant="secondary">{badge}</Badge>}
            </div>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {features.map((feature, index) => (
            <li
              key={index}
              className="text-muted-foreground flex items-start gap-2 text-sm"
            >
              <span className="text-primary">•</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CodeExample({
  title,
  code,
  language,
}: {
  title: string;
  code: string;
  language?: string;
}) {
  return (
    <div className="mb-6">
      <h4 className="mb-3 font-semibold">{title}</h4>
      <pre
        className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-sm text-gray-100"
        data-language={language}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default async function FeaturesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  return (
    <DocsLayout lang={lang} tableOfContents={tableOfContents}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-12">
          <h1 className="mb-4 text-4xl font-bold">Cronium Features</h1>
          <p className="text-muted-foreground text-xl">
            Discover all the powerful features that make Cronium the ultimate
            automation platform for modern development teams.
          </p>
        </div>

        <div className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-2">
          <FeatureCard
            icon={Terminal}
            title="Script Automation"
            description="Execute scripts across multiple languages and environments"
            features={[
              "Bash, Python, Node.js, and HTTP request support",
              "Environment variable injection",
              "Script templates and snippets",
              "Real-time execution logs",
              "Error handling and retry logic",
            ]}
          />

          <FeatureCard
            icon={Server}
            title="Remote Execution"
            description="Run scripts on remote servers via secure SSH connections"
            features={[
              "SSH key-based authentication",
              "Multi-server management",
              "Health monitoring and status checks",
              "Encrypted credential storage",
              "Connection pooling and optimization",
            ]}
          />

          <FeatureCard
            icon={Workflow}
            title="Workflow Engine"
            description="Build complex automation workflows with visual editor"
            features={[
              "Drag-and-drop workflow builder",
              "Conditional logic and branching",
              "Parallel and sequential execution",
              "Error handling and rollback",
              "Workflow templates and sharing",
            ]}
            badge="Advanced"
          />

          <FeatureCard
            icon={Clock}
            title="Scheduling System"
            description="Flexible scheduling with cron expressions and triggers"
            features={[
              "Cron expression support",
              "One-time and recurring schedules",
              "Time zone handling",
              "Schedule conflict detection",
              "Manual trigger override",
            ]}
          />

          <FeatureCard
            icon={Eye}
            title="Real-time Monitoring"
            description="Monitor execution status and performance metrics"
            features={[
              "Live execution tracking",
              "Performance metrics and analytics",
              "Resource usage monitoring",
              "Historical execution data",
              "Custom dashboard views",
            ]}
          />

          <FeatureCard
            icon={Shield}
            title="Security Features"
            description="Enterprise-grade security and data protection"
            features={[
              "End-to-end encryption",
              "Role-based access control",
              "Audit logs and compliance",
              "API token management",
              "Security scanning and validation",
            ]}
          />
        </div>

        <section id="script-automation" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">Script Automation</h2>
          <div className="space-y-6">
            <p className="text-muted-foreground text-lg">
              Cronium supports multiple scripting languages and execution
              environments, making it easy to automate any task regardless of
              your technology stack.
            </p>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <CodeExample
                  title="Bash Script Example"
                  code={`#!/bin/bash

# System maintenance script
echo "Starting system maintenance..."

# Update system packages
apt update && apt upgrade -y

# Clean up logs older than 7 days
find /var/log -name "*.log" -mtime +7 -delete

# Check disk usage
df -h | grep -E "(80%|90%|100%)" && echo "WARNING: High disk usage detected"

echo "Maintenance completed at $(date)"`}
                />
              </div>

              <div>
                <CodeExample
                  title="Python Script Example"
                  language="python"
                  code={`#!/usr/bin/env python3

import requests
import json
from datetime import datetime

# Database backup validation
def validate_backup():
    backup_url = "https://api.example.com/backup/status"
    
    response = requests.get(backup_url)
    data = response.json()
    
    if data['status'] == 'completed':
        print(f"✅ Backup completed successfully at {data['timestamp']}")
        return True
    else:
        print(f"❌ Backup failed: {data['error']}")
        return False

if __name__ == "__main__":
    success = validate_backup()
    exit(0 if success else 1)`}
                />
              </div>
            </div>
          </div>
        </section>

        <section id="remote-execution" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">Remote Execution</h2>
          <div className="space-y-6">
            <p className="text-muted-foreground text-lg">
              Execute scripts on multiple remote servers simultaneously with
              secure SSH connections and comprehensive monitoring.
            </p>

            <div className="bg-muted rounded-lg p-6">
              <h3 className="mb-4 font-semibold">Server Management Features</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <h4 className="mb-2 font-medium">Connection Management</h4>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Persistent SSH connections</li>
                    <li>• Connection pooling</li>
                    <li>• Automatic reconnection</li>
                    <li>• Health check monitoring</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-2 font-medium">Security</h4>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• SSH key authentication</li>
                    <li>• Encrypted credential storage</li>
                    <li>• Access logging</li>
                    <li>• Permission validation</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="workflow-engine" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">Workflow Engine</h2>
          <div className="space-y-6">
            <p className="text-muted-foreground text-lg">
              Create sophisticated automation workflows with our visual editor.
              Chain multiple events together with conditional logic and error
              handling.
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Workflow Capabilities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  <div>
                    <h4 className="mb-3 flex items-center gap-2 font-semibold">
                      <GitFork className="h-4 w-4" />
                      Conditional Logic
                    </h4>
                    <ul className="text-muted-foreground space-y-1 text-sm">
                      <li>• If/else conditions</li>
                      <li>• Switch statements</li>
                      <li>• Exit code handling</li>
                      <li>• Variable comparison</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="mb-3 flex items-center gap-2 font-semibold">
                      <Zap className="h-4 w-4" />
                      Execution Control
                    </h4>
                    <ul className="text-muted-foreground space-y-1 text-sm">
                      <li>• Parallel execution</li>
                      <li>• Sequential flows</li>
                      <li>• Delay and timeout</li>
                      <li>• Retry mechanisms</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="mb-3 flex items-center gap-2 font-semibold">
                      <Database className="h-4 w-4" />
                      Data Flow
                    </h4>
                    <ul className="text-muted-foreground space-y-1 text-sm">
                      <li>• Variable passing</li>
                      <li>• Output transformation</li>
                      <li>• Data validation</li>
                      <li>• Result aggregation</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="scheduling-system" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">Scheduling System</h2>
          <div className="space-y-6">
            <p className="text-muted-foreground text-lg">
              Flexible scheduling system supporting cron expressions, one-time
              executions, and complex recurring patterns.
            </p>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Schedule Types</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium">Cron Expressions</h4>
                      <p className="text-muted-foreground text-sm">
                        Standard cron syntax with second precision
                      </p>
                      <div className="bg-muted mt-2 rounded p-2 font-mono text-sm">
                        0 2 * * * # Daily at 2 AM
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium">One-time Execution</h4>
                      <p className="text-muted-foreground text-sm">
                        Schedule for specific date and time
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium">Interval-based</h4>
                      <p className="text-muted-foreground text-sm">
                        Run every N minutes, hours, or days
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Advanced Features</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium">Timezone Support</h4>
                      <p className="text-muted-foreground text-sm">
                        Execute in specific timezones
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium">Conflict Detection</h4>
                      <p className="text-muted-foreground text-sm">
                        Prevent overlapping executions
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium">Execution Windows</h4>
                      <p className="text-muted-foreground text-sm">
                        Define valid execution periods
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section id="real-time-monitoring" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">Real-time Monitoring</h2>
          <div className="space-y-6">
            <p className="text-muted-foreground text-lg">
              Comprehensive monitoring and analytics to track performance,
              identify issues, and optimize your automation workflows.
            </p>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-4 w-4" />
                    Live Execution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Real-time log streaming</li>
                    <li>• Progress indicators</li>
                    <li>• Resource usage tracking</li>
                    <li>• Status notifications</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Database className="h-4 w-4" />
                    Analytics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Execution history</li>
                    <li>• Performance metrics</li>
                    <li>• Success/failure rates</li>
                    <li>• Duration trends</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bell className="h-4 w-4" />
                    Alerting
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Failure notifications</li>
                    <li>• Performance alerts</li>
                    <li>• Custom thresholds</li>
                    <li>• Multiple channels</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section id="security-features" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">Security Features</h2>
          <div className="space-y-6">
            <p className="text-muted-foreground text-lg">
              Enterprise-grade security features to protect your infrastructure
              and ensure compliance with security best practices.
            </p>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lock className="h-5 w-5" />
                    Data Protection
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <h4 className="font-medium">Encryption at Rest</h4>
                    <p className="text-muted-foreground text-sm">
                      All sensitive data encrypted using AES-256
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">Encryption in Transit</h4>
                    <p className="text-muted-foreground text-sm">
                      TLS 1.3 for all API communications
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">Credential Management</h4>
                    <p className="text-muted-foreground text-sm">
                      Secure storage of SSH keys and API tokens
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Access Control
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <h4 className="font-medium">Role-Based Access</h4>
                    <p className="text-muted-foreground text-sm">
                      Granular permissions and user roles
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">API Authentication</h4>
                    <p className="text-muted-foreground text-sm">
                      Token-based API access with scopes
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">Audit Logging</h4>
                    <p className="text-muted-foreground text-sm">
                      Complete audit trail of all actions
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section id="api-integration" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">API Integration</h2>
          <div className="space-y-6">
            <p className="text-muted-foreground text-lg">
              Comprehensive REST API for integrating Cronium with your existing
              tools and workflows.
            </p>

            <div className="bg-muted rounded-lg p-6">
              <h3 className="mb-4 font-semibold">API Features</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div>
                  <h4 className="mb-2 font-medium">Event Management</h4>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Create and update events</li>
                    <li>• Execute events remotely</li>
                    <li>• Retrieve execution logs</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-2 font-medium">Workflow Control</h4>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Trigger workflows</li>
                    <li>• Monitor progress</li>
                    <li>• Handle callbacks</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-2 font-medium">System Integration</h4>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Webhook notifications</li>
                    <li>• Event streaming</li>
                    <li>• Third-party connectors</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="environment-management" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">Environment Management</h2>
          <p className="text-muted-foreground mb-6 text-lg">
            Manage environment variables and configuration across different
            deployment environments.
          </p>

          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <h4 className="mb-3 font-semibold">Environment Variables</h4>
                  <ul className="text-muted-foreground space-y-2 text-sm">
                    <li>• Global and event-specific variables</li>
                    <li>• Encrypted storage of sensitive values</li>
                    <li>• Environment-based configuration</li>
                    <li>• Variable inheritance and overrides</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-3 font-semibold">
                    Configuration Management
                  </h4>
                  <ul className="text-muted-foreground space-y-2 text-sm">
                    <li>• Environment profiles (dev, staging, prod)</li>
                    <li>• Configuration templating</li>
                    <li>• Version control integration</li>
                    <li>• Deployment-specific settings</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="notification-system" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">Notification System</h2>
          <p className="text-muted-foreground mb-6 text-lg">
            Stay informed about your automation status with comprehensive
            notification options.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Email Notifications</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-muted-foreground space-y-1 text-sm">
                  <li>• Success/failure alerts</li>
                  <li>• Scheduled reports</li>
                  <li>• Custom templates</li>
                  <li>• Distribution lists</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Webhook Integration</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-muted-foreground space-y-1 text-sm">
                  <li>• Real-time event streaming</li>
                  <li>• Custom payload formats</li>
                  <li>• Retry mechanisms</li>
                  <li>• Authentication headers</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Third-party Services
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-muted-foreground space-y-1 text-sm">
                  <li>• Slack integration</li>
                  <li>• Microsoft Teams</li>
                  <li>• PagerDuty alerts</li>
                  <li>• Custom connectors</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="role-based-access" className="mb-12">
          <h2 className="mb-6 text-3xl font-bold">Role-Based Access Control</h2>
          <p className="text-muted-foreground mb-6 text-lg">
            Granular permission system to control user access and maintain
            security.
          </p>

          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
                <div>
                  <h4 className="mb-3 font-semibold">Admin</h4>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Full system access</li>
                    <li>• User management</li>
                    <li>• System configuration</li>
                    <li>• Audit logs</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-3 font-semibold">Developer</h4>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Create/edit events</li>
                    <li>• Execute workflows</li>
                    <li>• View logs</li>
                    <li>• API access</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-3 font-semibold">Operator</h4>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Execute events</li>
                    <li>• Monitor status</li>
                    <li>• View logs</li>
                    <li>• Basic reporting</li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-3 font-semibold">Viewer</h4>
                  <ul className="text-muted-foreground space-y-1 text-sm">
                    <li>• Read-only access</li>
                    <li>• View events</li>
                    <li>• Monitor status</li>
                    <li>• Basic logs</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <div className="rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 dark:border-blue-800 dark:from-blue-950 dark:to-indigo-950">
          <h3 className="mb-2 font-semibold">Ready to Get Started?</h3>
          <p className="text-muted-foreground mb-4 text-sm">
            Explore our comprehensive documentation to learn how to use these
            features in your automation workflows.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={`/${lang}/docs/quick-start`}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm transition-colors"
            >
              Quick Start Guide
            </a>
            <a
              href={`/${lang}/docs/api`}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              API Documentation
            </a>
          </div>
        </div>
      </div>
    </DocsLayout>
  );
}
