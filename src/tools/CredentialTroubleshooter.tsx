"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Tool } from "@/shared/schema";
import { ToolPluginRegistry } from "./types/tool-plugin";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  HelpCircle,
  Info,
  Lightbulb,
  Search,
  Settings,
  Shield,
  Wrench,
  Zap,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface CredentialTroubleshooterProps {
  tool?: Tool;
  error?: string;
  className?: string;
}

interface TroubleshootingStep {
  id: string;
  title: string;
  description: string;
  category:
    | "authentication"
    | "permissions"
    | "network"
    | "configuration"
    | "general";
  solutions: Solution[];
}

interface Solution {
  title: string;
  steps: string[];
  code?: string;
  link?: {
    url: string;
    text: string;
  };
}

// Tool-specific troubleshooting guides
const TROUBLESHOOTING_GUIDES: Record<string, TroubleshootingStep[]> = {
  SLACK: [
    {
      id: "slack-webhook-404",
      title: "Webhook URL Returns 404",
      description: "The webhook URL is invalid or has been deleted",
      category: "authentication",
      solutions: [
        {
          title: "Regenerate Webhook URL",
          steps: [
            "Go to your Slack workspace settings",
            "Navigate to Apps > Manage > Custom Integrations > Incoming Webhooks",
            "Create a new webhook or find your existing one",
            "Copy the webhook URL",
            "Update your credentials in Cronium",
          ],
          link: {
            url: "https://api.slack.com/messaging/webhooks",
            text: "Slack Webhooks Documentation",
          },
        },
      ],
    },
    {
      id: "slack-oauth-expired",
      title: "OAuth Token Expired",
      description: "Your Slack OAuth token has expired or been revoked",
      category: "authentication",
      solutions: [
        {
          title: "Refresh OAuth Token",
          steps: [
            "Click 'Reconnect' in the credential manager",
            "Authorize the app in Slack",
            "Grant the required permissions",
            "The token will be automatically updated",
          ],
        },
        {
          title: "Create New App Token",
          steps: [
            "Visit api.slack.com/apps",
            "Select your app or create a new one",
            "Go to OAuth & Permissions",
            "Add required scopes",
            "Install to workspace and copy the token",
          ],
          code: "xoxb-your-token-here",
        },
      ],
    },
    {
      id: "slack-rate-limit",
      title: "Rate Limit Exceeded",
      description: "Too many requests to Slack API",
      category: "general",
      solutions: [
        {
          title: "Implement Rate Limiting",
          steps: [
            "Reduce the frequency of your events",
            "Batch messages when possible",
            "Use Slack's rate limit headers to throttle requests",
            "Consider using a queue for messages",
          ],
        },
      ],
    },
  ],
  DISCORD: [
    {
      id: "discord-webhook-invalid",
      title: "Invalid Webhook URL",
      description: "The Discord webhook URL is malformed or incorrect",
      category: "authentication",
      solutions: [
        {
          title: "Verify Webhook Format",
          steps: [
            "Ensure the URL starts with https://discord.com/api/webhooks/",
            "Check that the webhook ID and token are included",
            "Test the webhook using curl or Postman",
          ],
          code: 'curl -X POST -H "Content-Type: application/json" -d \'{"content":"Test"}\' YOUR_WEBHOOK_URL',
        },
        {
          title: "Create New Webhook",
          steps: [
            "Open your Discord server",
            "Go to Server Settings > Integrations > Webhooks",
            "Click 'New Webhook'",
            "Configure the webhook and copy the URL",
          ],
          link: {
            url: "https://support.discord.com/hc/en-us/articles/228383668",
            text: "Discord Webhook Guide",
          },
        },
      ],
    },
  ],
  EMAIL: [
    {
      id: "email-smtp-connection",
      title: "SMTP Connection Failed",
      description: "Cannot connect to the SMTP server",
      category: "network",
      solutions: [
        {
          title: "Check SMTP Settings",
          steps: [
            "Verify the SMTP host and port are correct",
            "Common ports: 25 (unencrypted), 465 (SSL), 587 (TLS)",
            "Ensure your firewall allows outbound connections",
            "Test with telnet: telnet smtp.gmail.com 587",
          ],
        },
        {
          title: "Enable Less Secure Apps (Gmail)",
          steps: [
            "Go to Google Account settings",
            "Navigate to Security",
            "Enable 'Less secure app access' or use App Passwords",
            "Generate an app-specific password for Cronium",
          ],
          link: {
            url: "https://support.google.com/accounts/answer/185833",
            text: "Gmail App Passwords",
          },
        },
      ],
    },
    {
      id: "email-auth-failed",
      title: "Authentication Failed",
      description: "SMTP authentication credentials are incorrect",
      category: "authentication",
      solutions: [
        {
          title: "Verify Credentials",
          steps: [
            "Double-check username and password",
            "For Gmail, use your full email address",
            "Consider using app-specific passwords",
            "Ensure 2FA is properly configured",
          ],
        },
      ],
    },
  ],
};

// Common troubleshooting steps for all tools
const COMMON_TROUBLESHOOTING: TroubleshootingStep[] = [
  {
    id: "common-network-timeout",
    title: "Connection Timeout",
    description: "The request is timing out before completing",
    category: "network",
    solutions: [
      {
        title: "Check Network Connectivity",
        steps: [
          "Verify your internet connection is stable",
          "Check if the service is accessible from your network",
          "Try using a different network or VPN",
          "Check for proxy or firewall restrictions",
        ],
      },
      {
        title: "Increase Timeout Settings",
        steps: [
          "Contact support to increase timeout limits",
          "Consider breaking large requests into smaller chunks",
          "Implement retry logic with exponential backoff",
        ],
      },
    ],
  },
  {
    id: "common-ssl-error",
    title: "SSL/TLS Certificate Error",
    description: "Certificate verification failed",
    category: "network",
    solutions: [
      {
        title: "Verify Certificate",
        steps: [
          "Check if the service's SSL certificate is valid",
          "Ensure your system time is correct",
          "Update your certificate bundle",
          "Try accessing the service via HTTPS in a browser",
        ],
      },
    ],
  },
];

export default function CredentialTroubleshooter({
  tool,
  error,
  className,
}: CredentialTroubleshooterProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Get relevant troubleshooting steps
  const getRelevantSteps = () => {
    let steps: TroubleshootingStep[] = [...COMMON_TROUBLESHOOTING];

    if (tool) {
      const toolSteps = TROUBLESHOOTING_GUIDES[tool.type] ?? [];
      steps = [...toolSteps, ...steps];
    }

    // Filter by search query
    if (searchQuery) {
      steps = steps.filter(
        (step) =>
          step.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          step.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          step.solutions.some((solution) =>
            solution.title.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
      );
    }

    // Filter by category
    if (selectedCategory !== "all") {
      steps = steps.filter((step) => step.category === selectedCategory);
    }

    // If error is provided, prioritize relevant steps
    if (error) {
      const errorLower = error.toLowerCase();
      steps.sort((a, b) => {
        const aRelevance =
          a.title.toLowerCase().includes(errorLower) ||
          a.description.toLowerCase().includes(errorLower)
            ? 1
            : 0;
        const bRelevance =
          b.title.toLowerCase().includes(errorLower) ||
          b.description.toLowerCase().includes(errorLower)
            ? 1
            : 0;
        return bRelevance - aRelevance;
      });
    }

    return steps;
  };

  const relevantSteps = getRelevantSteps();

  // Copy code to clipboard
  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast({
        title: "Copied",
        description: "Code copied to clipboard",
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to copy code",
        variant: "destructive",
      });
    }
  };

  const categories = [
    { id: "all", label: "All Issues", icon: HelpCircle },
    { id: "authentication", label: "Authentication", icon: Shield },
    { id: "permissions", label: "Permissions", icon: Settings },
    { id: "network", label: "Network", icon: Zap },
    { id: "configuration", label: "Configuration", icon: Wrench },
    { id: "general", label: "General", icon: Info },
  ];

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          Troubleshooting Guide
          {tool && (
            <Badge variant="outline" className="ml-2">
              {ToolPluginRegistry.get(tool.type)?.name}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">
          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Current Error:</strong> {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Search and Filters */}
          <div className="space-y-4">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search troubleshooting guides..."
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSearchQuery(e.target.value)
                }
                className="pl-9"
              />
            </div>

            <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
              <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
                {categories.map((category) => (
                  <TabsTrigger
                    key={category.id}
                    value={category.id}
                    className="gap-1"
                  >
                    <category.icon className="h-3 w-3" />
                    <span className="hidden sm:inline">{category.label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {/* Troubleshooting Steps */}
          {relevantSteps.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No troubleshooting guides found matching your criteria.
              </AlertDescription>
            </Alert>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {relevantSteps.map((step) => (
                <AccordionItem key={step.id} value={step.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-start gap-3 text-left">
                      <AlertCircle className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                      <div className="space-y-1">
                        <h4 className="font-medium">{step.title}</h4>
                        <p className="text-muted-foreground text-sm">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pl-7">
                      {step.solutions.map((solution, idx) => (
                        <div
                          key={idx}
                          className="border-border space-y-3 rounded-lg border p-4"
                        >
                          <h5 className="font-medium">{solution.title}</h5>

                          <ol className="space-y-2">
                            {solution.steps.map((stepText, stepIdx) => (
                              <li
                                key={stepIdx}
                                className="flex items-start gap-2 text-sm"
                              >
                                <span className="bg-primary/10 text-primary mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                                  {stepIdx + 1}
                                </span>
                                <span className="text-muted-foreground">
                                  {stepText}
                                </span>
                              </li>
                            ))}
                          </ol>

                          {solution.code && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm">Example Code</Label>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyCode(solution.code!)}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                              <pre className="bg-muted rounded-lg p-3 text-xs">
                                <code>{solution.code}</code>
                              </pre>
                            </div>
                          )}

                          {solution.link && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() =>
                                window.open(solution.link!.url, "_blank")
                              }
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              {solution.link.text}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}

          {/* Additional Resources */}
          <div className="border-border bg-muted/50 rounded-lg border p-4">
            <h4 className="mb-3 flex items-center gap-2 font-medium">
              <FileText className="h-4 w-4" />
              Additional Resources
            </h4>
            <div className="space-y-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => window.open("/docs/tools", "_blank")}
              >
                <ChevronRight className="mr-2 h-4 w-4" />
                Tool Integration Documentation
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => window.open("/support", "_blank")}
              >
                <ChevronRight className="mr-2 h-4 w-4" />
                Contact Support
              </Button>
              {tool && ToolPluginRegistry.get(tool.type)?.docsUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() =>
                    window.open(
                      ToolPluginRegistry.get(tool.type)?.docsUrl,
                      "_blank",
                    )
                  }
                >
                  <ChevronRight className="mr-2 h-4 w-4" />
                  Official {ToolPluginRegistry.get(tool.type)?.name} Docs
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
