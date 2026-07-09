/**
 * The secondary feature cards.
 *
 * Every `href` must resolve to a route that exists under `src/app/docs`, and
 * every `#anchor` must match an `id` on the target page. The cards render as
 * links, so a wrong href here ships a dead link on the landing page. See the
 * dead-link check in the section's verification steps.
 */

export type FeatureIcon =
  | "workflow"
  | "server"
  | "clock"
  | "terminal"
  | "users"
  | "activity"
  | "key"
  | "brain"
  | "bell";

export interface Feature {
  icon: FeatureIcon;
  title: string;
  description: string;
  href: string;
}

export const FEATURES: Feature[] = [
  {
    icon: "workflow",
    title: "Visual Workflow Builder",
    description:
      "Chain events on a canvas with conditional branches, parallel execution, and data passed between steps.",
    href: "/docs/how-to/build-workflow",
  },
  {
    icon: "server",
    title: "Remote Execution",
    description:
      "Run scripts locally or on remote servers over SSH, across many servers at once.",
    href: "/docs/features#remote-execution",
  },
  {
    icon: "clock",
    title: "Advanced Scheduling",
    description:
      "Trigger on an interval or a cron expression, or run on demand from the dashboard.",
    href: "/docs/features#scheduling-system",
  },
  {
    icon: "terminal",
    title: "Integrated Terminal",
    description:
      "Open a real-time terminal against any connected server, straight from the browser.",
    href: "/docs/how-to/connect-server",
  },
  {
    icon: "users",
    title: "Role-Based Access Control",
    description:
      "Admin, User, and Viewer roles with granular, server-enforced permissions.",
    href: "/docs/features#role-based-access",
  },
  {
    icon: "activity",
    title: "System Monitoring",
    description:
      "Track execution history, server health, and success rates as runs happen.",
    href: "/docs/features#real-time-monitoring",
  },
  {
    icon: "key",
    title: "API Access",
    description:
      "Manage events, workflows, servers, and variables programmatically with API tokens.",
    href: "/docs/api",
  },
  {
    icon: "brain",
    title: "AI-Powered Script Generation",
    description:
      "Draft scripts from a prompt with OpenAI, then edit them in the built-in editor.",
    href: "/docs/tools#available-tools",
  },
  {
    icon: "bell",
    title: "Built-in Integrations",
    description:
      "Notify Slack, Discord, Microsoft Teams, Notion, Trello, Google Sheets, or email on success or failure.",
    href: "/docs/tools",
  },
];
