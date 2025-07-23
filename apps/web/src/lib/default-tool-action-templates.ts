/**
 * Default Tool Action Templates for Cronium
 *
 * These templates provide ready-to-use configurations for common tool action scenarios
 */

export interface DefaultToolActionTemplate {
  name: string;
  description: string;
  toolType: string;
  actionId: string;
  parameters: Record<string, unknown>;
}

export const defaultToolActionTemplates: DefaultToolActionTemplate[] = [
  // Discord Templates
  {
    name: "Event Success Notification",
    description: "Send a success notification when an event completes",
    toolType: "discord",
    actionId: "send-message",
    parameters: {
      content:
        "✅ **Event Completed Successfully**\n\n**Event:** {{cronium.event.name}}\n**Status:** {{cronium.event.status}}\n**Duration:** {{formatDuration cronium.event.duration}}\n**Time:** {{formatTime cronium.event.executionTime}}",
    },
  },
  {
    name: "Event Failure Alert",
    description: "Send an alert when an event fails",
    toolType: "discord",
    actionId: "send-message",
    parameters: {
      content:
        "❌ **Event Failed**\n\n**Event:** {{cronium.event.name}}\n**Status:** {{cronium.event.status}}\n**Error:** ```{{cronium.event.error}}```\n**Time:** {{formatTime cronium.event.executionTime}}",
    },
  },
  {
    name: "Daily Summary",
    description: "Send a daily summary message",
    toolType: "discord",
    actionId: "send-message",
    parameters: {
      content:
        "📊 **Daily Summary**\n\nHello team! Here's your daily automation summary:\n\n{{#if cronium.getVariables.successCount}}✅ Successful runs: {{cronium.getVariables.successCount}}{{/if}}\n{{#if cronium.getVariables.failureCount}}❌ Failed runs: {{cronium.getVariables.failureCount}}{{/if}}\n\nHave a great day! 🚀",
    },
  },

  // Slack Templates
  {
    name: "Event Success Notification",
    description: "Send a success notification when an event completes",
    toolType: "slack",
    actionId: "send-message",
    parameters: {
      text: "✅ Event `{{cronium.event.name}}` completed successfully in {{formatDuration cronium.event.duration}}",
    },
  },
  {
    name: "Event Failure Alert",
    description: "Send an alert when an event fails",
    toolType: "slack",
    actionId: "send-message",
    parameters: {
      text: "❌ Event `{{cronium.event.name}}` failed with error:\n```{{cronium.event.error}}```",
      channel: "#alerts",
    },
  },
  {
    name: "Deployment Notification",
    description: "Notify team about deployment status",
    toolType: "slack",
    actionId: "send-message",
    parameters: {
      text: "🚀 Deployment of `{{cronium.getVariables.appName}}` to `{{cronium.getVariables.environment}}` {{cronium.event.status}}!",
      channel: "#deployments",
    },
  },

  // Email Templates
  {
    name: "Event Success Report",
    description: "Send a detailed success report via email",
    toolType: "email",
    actionId: "send-email",
    parameters: {
      to: "{{cronium.getVariables.adminEmail}}",
      subject: "✅ Event Success: {{cronium.event.name}}",
      body: `Dear Administrator,

Your automated event has completed successfully.

Event Details:
- Name: {{cronium.event.name}}
- Status: {{cronium.event.status}}
- Duration: {{formatDuration cronium.event.duration}}
- Execution Time: {{formatTime cronium.event.executionTime}}
- Server: {{cronium.event.server}}

{{#if cronium.event.output}}
Output:
{{cronium.event.output}}
{{/if}}

Best regards,
Cronium Automation Platform`,
    },
  },
  {
    name: "Event Failure Alert",
    description: "Send an urgent failure alert via email",
    toolType: "email",
    actionId: "send-email",
    parameters: {
      to: "{{cronium.getVariables.adminEmail}}",
      subject: "❌ URGENT: Event Failed - {{cronium.event.name}}",
      body: `Dear Administrator,

An automated event has failed and requires your attention.

Event Details:
- Name: {{cronium.event.name}}
- Status: {{cronium.event.status}}
- Execution Time: {{formatTime cronium.event.executionTime}}
- Server: {{cronium.event.server}}

Error Details:
{{cronium.event.error}}

Please investigate this issue as soon as possible.

Best regards,
Cronium Automation Platform`,
    },
  },
  {
    name: "Weekly Summary Report",
    description: "Send a weekly summary of all events",
    toolType: "email",
    actionId: "send-email",
    parameters: {
      to: "{{cronium.getVariables.reportEmail}}",
      subject:
        "Weekly Automation Summary - {{formatTime cronium.event.executionTime}}",
      body: `Dear Team,

Here's your weekly automation summary:

Total Events Run: {{cronium.getVariables.totalEvents}}
Successful: {{cronium.getVariables.successfulEvents}}
Failed: {{cronium.getVariables.failedEvents}}
Average Duration: {{cronium.getVariables.avgDuration}}

{{#if cronium.getVariables.notableEvents}}
Notable Events:
{{cronium.getVariables.notableEvents}}
{{/if}}

For detailed logs, please check the Cronium dashboard.

Best regards,
Cronium Automation Platform`,
    },
  },
];

/**
 * Get default templates for a specific tool type
 */
export function getDefaultTemplatesForTool(
  toolType: string,
): DefaultToolActionTemplate[] {
  return defaultToolActionTemplates.filter(
    (template) => template.toolType === toolType,
  );
}

/**
 * Get default templates for a specific tool and action
 */
export function getDefaultTemplatesForAction(
  toolType: string,
  actionId: string,
): DefaultToolActionTemplate[] {
  return defaultToolActionTemplates.filter(
    (template) =>
      template.toolType === toolType && template.actionId === actionId,
  );
}
