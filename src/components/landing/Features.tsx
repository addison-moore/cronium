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
import { useTranslations } from "next-intl";

export default function Features() {
  let t;
  try {
    t = useTranslations("Home.Features");
  } catch (error) {
    console.error("Translation error:", error);
    // Fallback if translations not available
    t = (key: string) => key;
  }

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
      title: t("Cards.RemoteExecution.Title"),
      description: t("Cards.RemoteExecution.Description"),
      category: "Execution",
    },
    {
      icon: <Clock className="h-6 w-6" />,
      title: t("Cards.Scheduling.Title"),
      description: t("Cards.Scheduling.Description"),
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
      title: t("Cards.EventTypes.Title"),
      description: t("Cards.EventTypes.Description"),
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
      title: t("Cards.Notifications.Title"),
      description: t("Cards.Notifications.Description"),
      category: "Monitoring",
    },
    {
      icon: <BarChart className="h-6 w-6" />,
      title: t("Cards.Logging.Title"),
      description: t("Cards.Logging.Description"),
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
    <section
      id="features"
      className="py-16 md:py-24 bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-950 dark:to-gray-900"
    >
      <div className="container px-4 md:px-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16 space-y-4">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
            {t("Title")}
          </h2>
          <p className="mx-auto max-w-3xl text-lg text-gray-600 dark:text-gray-300">
            {t("Subtitle")}
          </p>

          {/* Category Pills */}
          <div className="flex flex-wrap justify-center gap-2 mt-8">
            {categories.map((category) => (
              <span
                key={category.name}
                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium text-white ${category.color}`}
              >
                {category.name}
              </span>
            ))}
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {coreFeatures.map((feature, index) => {
            const category = categories.find(
              (cat) => cat.name === feature.category,
            );
            return (
              <div
                key={index}
                className="group relative p-6 bg-white dark:bg-gray-800/50 rounded-2xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
              >
                {/* Category Badge */}
                <div className="absolute top-4 right-4">
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium text-white ${category?.color || "bg-gray-500"}`}
                  >
                    {feature.category}
                  </span>
                </div>

                {/* Icon */}
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary/10 to-primary/20 text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
                  {feature.icon}
                </div>

                {/* Content */}
                <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white group-hover:text-primary transition-colors">
                  {feature.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* Feature Highlights */}
        <div className="mt-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
              Enterprise-Grade Platform
            </h3>
            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-green-600"></div>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">
                    Multi-Server Management
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Connect and manage multiple remote servers with encrypted
                    SSH connections and health monitoring.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">
                    Advanced Workflow Engine
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Create sophisticated automation workflows with conditional
                    logic, error handling, and rollback capabilities.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-purple-600"></div>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">
                    Security-First Design
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    End-to-end encryption, role-based access control, and secure
                    credential management protect your data.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-secondary/20 rounded-2xl blur-3xl"></div>
            <div className="relative bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 shadow-xl">
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    System Status: Operational
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">
                      Active Scripts
                    </span>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                      247
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">
                      Servers Connected
                    </span>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                      12
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">
                      Workflows Running
                    </span>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
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
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
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
