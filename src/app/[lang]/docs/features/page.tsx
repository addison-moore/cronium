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
  icon: any;
  title: string;
  description: string;
  features: string[];
  badge?: string;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Icon className="h-6 w-6 text-primary" />
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
              className="text-sm text-muted-foreground flex items-start gap-2"
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
  language = "bash",
}: {
  title: string;
  code: string;
  language?: string;
}) {
  return (
    <div className="mb-6">
      <h4 className="font-semibold mb-3">{title}</h4>
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
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
      <div className="max-w-4xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-4">Cronium Features</h1>
          <p className="text-xl text-muted-foreground">
            Discover all the powerful features that make Cronium the ultimate
            automation platform for modern development teams.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
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
          <h2 className="text-3xl font-bold mb-6">Script Automation</h2>
          <div className="space-y-6">
            <p className="text-lg text-muted-foreground">
              Cronium supports multiple scripting languages and execution
              environments, making it easy to automate any task regardless of
              your technology stack.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
          <h2 className="text-3xl font-bold mb-6">Remote Execution</h2>
          <div className="space-y-6">
            <p className="text-lg text-muted-foreground">
              Execute scripts on multiple remote servers simultaneously with
              secure SSH connections and comprehensive monitoring.
            </p>

            <div className="bg-muted p-6 rounded-lg">
              <h3 className="font-semibold mb-4">Server Management Features</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-2">Connection Management</h4>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• Persistent SSH connections</li>
                    <li>• Connection pooling</li>
                    <li>• Automatic reconnection</li>
                    <li>• Health check monitoring</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Security</h4>
                  <ul className="text-sm space-y-1 text-muted-foreground">
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
          <h2 className="text-3xl font-bold mb-6">Workflow Engine</h2>
          <div className="space-y-6">
            <p className="text-lg text-muted-foreground">
              Create sophisticated automation workflows with our visual editor.
              Chain multiple events together with conditional logic and error
              handling.
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Workflow Capabilities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <GitFork className="h-4 w-4" />
                      Conditional Logic
                    </h4>
                    <ul className="text-sm space-y-1 text-muted-foreground">
                      <li>• If/else conditions</li>
                      <li>• Switch statements</li>
                      <li>• Exit code handling</li>
                      <li>• Variable comparison</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      Execution Control
                    </h4>
                    <ul className="text-sm space-y-1 text-muted-foreground">
                      <li>• Parallel execution</li>
                      <li>• Sequential flows</li>
                      <li>• Delay and timeout</li>
                      <li>• Retry mechanisms</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Data Flow
                    </h4>
                    <ul className="text-sm space-y-1 text-muted-foreground">
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
          <h2 className="text-3xl font-bold mb-6">Scheduling System</h2>
          <div className="space-y-6">
            <p className="text-lg text-muted-foreground">
              Flexible scheduling system supporting cron expressions, one-time
              executions, and complex recurring patterns.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Schedule Types</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium">Cron Expressions</h4>
                      <p className="text-sm text-muted-foreground">
                        Standard cron syntax with second precision
                      </p>
                      <div className="bg-muted p-2 rounded mt-2 font-mono text-sm">
                        0 2 * * * # Daily at 2 AM
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium">One-time Execution</h4>
                      <p className="text-sm text-muted-foreground">
                        Schedule for specific date and time
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium">Interval-based</h4>
                      <p className="text-sm text-muted-foreground">
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
                      <p className="text-sm text-muted-foreground">
                        Execute in specific timezones
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium">Conflict Detection</h4>
                      <p className="text-sm text-muted-foreground">
                        Prevent overlapping executions
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium">Execution Windows</h4>
                      <p className="text-sm text-muted-foreground">
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
          <h2 className="text-3xl font-bold mb-6">Real-time Monitoring</h2>
          <div className="space-y-6">
            <p className="text-lg text-muted-foreground">
              Comprehensive monitoring and analytics to track performance,
              identify issues, and optimize your automation workflows.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Live Execution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• Real-time log streaming</li>
                    <li>• Progress indicators</li>
                    <li>• Resource usage tracking</li>
                    <li>• Status notifications</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Analytics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• Execution history</li>
                    <li>• Performance metrics</li>
                    <li>• Success/failure rates</li>
                    <li>• Duration trends</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    Alerting
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1 text-muted-foreground">
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
          <h2 className="text-3xl font-bold mb-6">Security Features</h2>
          <div className="space-y-6">
            <p className="text-lg text-muted-foreground">
              Enterprise-grade security features to protect your infrastructure
              and ensure compliance with security best practices.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                    <p className="text-sm text-muted-foreground">
                      All sensitive data encrypted using AES-256
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">Encryption in Transit</h4>
                    <p className="text-sm text-muted-foreground">
                      TLS 1.3 for all API communications
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">Credential Management</h4>
                    <p className="text-sm text-muted-foreground">
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
                    <p className="text-sm text-muted-foreground">
                      Granular permissions and user roles
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">API Authentication</h4>
                    <p className="text-sm text-muted-foreground">
                      Token-based API access with scopes
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium">Audit Logging</h4>
                    <p className="text-sm text-muted-foreground">
                      Complete audit trail of all actions
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section id="api-integration" className="mb-12">
          <h2 className="text-3xl font-bold mb-6">API Integration</h2>
          <div className="space-y-6">
            <p className="text-lg text-muted-foreground">
              Comprehensive REST API for integrating Cronium with your existing
              tools and workflows.
            </p>

            <div className="bg-muted p-6 rounded-lg">
              <h3 className="font-semibold mb-4">API Features</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <h4 className="font-medium mb-2">Event Management</h4>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• Create and update events</li>
                    <li>• Execute events remotely</li>
                    <li>• Retrieve execution logs</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Workflow Control</h4>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• Trigger workflows</li>
                    <li>• Monitor progress</li>
                    <li>• Handle callbacks</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-2">System Integration</h4>
                  <ul className="text-sm space-y-1 text-muted-foreground">
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
          <h2 className="text-3xl font-bold mb-6">Environment Management</h2>
          <p className="text-lg text-muted-foreground mb-6">
            Manage environment variables and configuration across different
            deployment environments.
          </p>

          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold mb-3">Environment Variables</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>• Global and event-specific variables</li>
                    <li>• Encrypted storage of sensitive values</li>
                    <li>• Environment-based configuration</li>
                    <li>• Variable inheritance and overrides</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold mb-3">
                    Configuration Management
                  </h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
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
          <h2 className="text-3xl font-bold mb-6">Notification System</h2>
          <p className="text-lg text-muted-foreground mb-6">
            Stay informed about your automation status with comprehensive
            notification options.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Email Notifications</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1 text-muted-foreground">
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
                <ul className="text-sm space-y-1 text-muted-foreground">
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
                <ul className="text-sm space-y-1 text-muted-foreground">
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
          <h2 className="text-3xl font-bold mb-6">Role-Based Access Control</h2>
          <p className="text-lg text-muted-foreground mb-6">
            Granular permission system to control user access and maintain
            security.
          </p>

          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div>
                  <h4 className="font-semibold mb-3">Admin</h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    <li>• Full system access</li>
                    <li>• User management</li>
                    <li>• System configuration</li>
                    <li>• Audit logs</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold mb-3">Developer</h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    <li>• Create/edit events</li>
                    <li>• Execute workflows</li>
                    <li>• View logs</li>
                    <li>• API access</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold mb-3">Operator</h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    <li>• Execute events</li>
                    <li>• Monitor status</li>
                    <li>• View logs</li>
                    <li>• Basic reporting</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold mb-3">Viewer</h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
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

        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 border border-blue-200 dark:border-blue-800 p-6 rounded-lg">
          <h3 className="font-semibold mb-2">Ready to Get Started?</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Explore our comprehensive documentation to learn how to use these
            features in your automation workflows.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href={`/${lang}/docs/quick-start`}
              className="inline-flex items-center justify-center px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm"
            >
              Quick Start Guide
            </a>
            <a
              href={`/${lang}/docs/api`}
              className="inline-flex items-center justify-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
            >
              API Documentation
            </a>
          </div>
        </div>
      </div>
    </DocsLayout>
  );
}
