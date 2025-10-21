"use client";

import {
  Clock,
  Code,
  Server,
  Bell,
  BarChart,
  Terminal,
  Workflow,
  Shield,
  Database,
  Key,
  Brain,
  Users,
} from "lucide-react";

export default function Features() {
  const coreFeatures = [
    {
      icon: <Workflow className="h-6 w-6" />,
      title: "Visual Workflow Builder",
      description:
        "Build complex automation workflows with drag-and-drop interface, conditional logic, and parallel execution.",
      category: "Automation",
    },
    {
      icon: <Server className="h-6 w-6" />,
      title: "Remote Execution",
      description:
        "Run scripts locally or on remote servers via SSH connections.",
      category: "Execution",
    },
    {
      icon: <Clock className="h-6 w-6" />,
      title: "Advanced Scheduling",
      description:
        "Schedule scripts to run at specific intervals or use custom cron expressions for complex timing needs.",
      category: "Scheduling",
    },
    {
      icon: <Terminal className="h-6 w-6" />,
      title: "Integrated Terminal",
      description:
        "Execute commands directly on remote servers with a secure, real-time terminal interface.",
      category: "Development",
    },
    {
      icon: <Code className="h-6 w-6" />,
      title: "Multiple Script Types",
      description:
        "Support for Python, Node.js, and Bash scripts with a built-in code editor.",
      category: "Development",
    },
    {
      icon: <Shield className="h-6 w-6" />,
      title: "End-to-End Encryption",
      description:
        "Client-side encryption for sensitive data including SSH keys, passwords, and environment variables.",
      category: "Security",
    },
    {
      icon: <Users className="h-6 w-6" />,
      title: "Role-Based Access Control",
      description:
        "Granular permissions system with custom roles for secure multi-user collaboration.",
      category: "Security",
    },
    {
      icon: <Database className="h-6 w-6" />,
      title: "System Monitoring",
      description:
        "Real-time server health monitoring with CPU, memory, and performance metrics.",
      category: "Monitoring",
    },
    {
      icon: <Key className="h-6 w-6" />,
      title: "API Token Management",
      description:
        "Secure API access with configurable permissions and automatic token rotation.",
      category: "Integration",
    },
    {
      icon: <Brain className="h-6 w-6" />,
      title: "AI-Powered Script Generation",
      description:
        "Generate scripts automatically using OpenAI integration for faster development.",
      category: "AI",
    },
    {
      icon: <Bell className="h-6 w-6" />,
      title: "Custom Notifications",
      description:
        "Configure webhooks and email notifications for script success or failure.",
      category: "Monitoring",
    },
    {
      icon: <BarChart className="h-6 w-6" />,
      title: "Detailed Logging",
      description:
        "View comprehensive execution logs with timestamps and output details.",
      category: "Monitoring",
    },
  ];

  const categories = [
    { name: "Automation", color: "bg-blue-500" },
    { name: "Execution", color: "bg-green-500" },
    { name: "Scheduling", color: "bg-purple-500" },
    { name: "Development", color: "bg-orange-500" },
    { name: "Security", color: "bg-red-500" },
    { name: "Monitoring", color: "bg-yellow-500" },
    { name: "Integration", color: "bg-indigo-500" },
    { name: "AI", color: "bg-pink-500" },
  ];

  return (
    <section id="features" className="bg-background py-16 md:py-24">
      <div className="container mx-auto max-w-7xl px-4 md:px-6">
        {/* Header */}
        <div className="mb-16 space-y-4 text-center">
          <h2 className="text-foreground text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Powerful Features
          </h2>
          <p className="text-muted-foreground mx-auto max-w-3xl text-lg">
            Everything you need to automate and manage your scripts in one place
          </p>

          {/* Category Pills */}
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {categories.map((category) => (
              <span
                key={category.name}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium text-white ${category.color}`}
              >
                {category.name}
              </span>
            ))}
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {coreFeatures.map((feature, index) => {
            const category = categories.find(
              (cat) => cat.name === feature.category,
            );
            return (
              <div
                key={index}
                className="group border-border bg-card hover:border-border relative rounded-2xl border p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                {/* Category Badge */}
                <div className="absolute top-4 right-4">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium text-white ${category?.color ?? "bg-gray-500"}`}
                  >
                    {feature.category}
                  </span>
                </div>

                {/* Icon */}
                <div className="from-primary/10 to-primary/20 text-primary mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br transition-transform duration-300 group-hover:scale-110">
                  {feature.icon}
                </div>

                {/* Content */}
                <h3 className="group-hover:text-primary text-card-foreground mb-3 text-lg font-semibold transition-colors">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* Feature Highlights */}
        <div className="mt-20 grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div className="space-y-6">
            <h3 className="text-foreground text-2xl font-bold">
              Enterprise-Grade Platform
            </h3>
            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                  <div className="h-2 w-2 rounded-full bg-green-600"></div>
                </div>
                <div>
                  <h4 className="text-foreground font-semibold">
                    Multi-Server Management
                  </h4>
                  <p className="text-muted-foreground text-sm">
                    Connect and manage multiple remote servers with encrypted
                    SSH connections and health monitoring.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
                  <div className="h-2 w-2 rounded-full bg-blue-600"></div>
                </div>
                <div>
                  <h4 className="text-foreground font-semibold">
                    Advanced Workflow Engine
                  </h4>
                  <p className="text-muted-foreground text-sm">
                    Create sophisticated automation workflows with conditional
                    logic, error handling, and rollback capabilities.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900">
                  <div className="h-2 w-2 rounded-full bg-purple-600"></div>
                </div>
                <div>
                  <h4 className="text-foreground font-semibold">
                    Security-First Design
                  </h4>
                  <p className="text-muted-foreground text-sm">
                    End-to-end encryption, role-based access control, and secure
                    credential management protect your data.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="from-primary/20 to-secondary/20 absolute inset-0 rounded-2xl bg-gradient-to-r blur-3xl"></div>
            <div className="border-border bg-card relative rounded-2xl border p-8 shadow-xl">
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="h-3 w-3 rounded-full bg-green-500"></div>
                  <span className="text-card-foreground text-sm font-medium">
                    System Status: Operational
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">
                      Active Scripts
                    </span>
                    <div className="text-card-foreground text-2xl font-bold">
                      247
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Servers Connected
                    </span>
                    <div className="text-card-foreground text-2xl font-bold">
                      12
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Workflows Running
                    </span>
                    <div className="text-card-foreground text-2xl font-bold">
                      38
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">
                      Success Rate
                    </span>
                    <div className="text-2xl font-bold text-green-600">
                      99.7%
                    </div>
                  </div>
                </div>
                <div className="border-border border-t pt-4">
                  <div className="text-muted-foreground flex items-center justify-between text-xs">
                    <span>Last updated: 2 minutes ago</span>
                    <span>Uptime: 99.99%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
