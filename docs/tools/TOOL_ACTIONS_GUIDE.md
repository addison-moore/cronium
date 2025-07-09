# Tool Actions User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Setting Up Tools](#setting-up-tools)
4. [Creating Tool Action Events](#creating-tool-action-events)
5. [Using the Tools Dashboard](#using-the-tools-dashboard)
6. [Supported Tools](#supported-tools)
7. [Advanced Features](#advanced-features)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

## Introduction

Tool Actions in Cronium allow you to integrate with external services like Slack, Discord, Email, and more. Instead of writing scripts, you can use pre-built actions to send messages, create tasks, update spreadsheets, and perform other operations.

### Key Benefits

- **No coding required** - Use visual configuration instead of scripts
- **Pre-built integrations** - Connect to popular services instantly
- **Secure credential management** - Credentials are encrypted and stored safely
- **Real-time monitoring** - Track execution status and health
- **Workflow compatible** - Use tool actions in multi-step workflows

## Getting Started

### Prerequisites

- Active Cronium account
- Credentials for the services you want to integrate (webhook URLs, API keys, etc.)
- Appropriate permissions in your target services

### Quick Start

1. Navigate to **Dashboard > Settings > Tools**
2. Click **"Add Tool"** and select your service
3. Enter your credentials and save
4. Go to **Dashboard > Events > New Event**
5. Select **"Tool Action"** as the event type
6. Choose your tool and action
7. Configure parameters and save

## Setting Up Tools

### Step 1: Access Tools Settings

Navigate to **Dashboard > Settings > Tools** or click the **Tools** tab in settings.

### Step 2: Add a New Tool

1. Click the **"Add Tool"** button
2. Select the tool type from the dropdown
3. Give your tool a descriptive name (e.g., "Team Slack", "Customer Discord")
4. Enter the required credentials

### Step 3: Configure Credentials

#### Slack

- **Webhook URL**: Get from Slack App settings
  1. Go to https://api.slack.com/apps
  2. Create or select your app
  3. Enable "Incoming Webhooks"
  4. Copy the webhook URL

#### Discord

- **Webhook URL**: Get from Discord channel settings
  1. Right-click on your Discord channel
  2. Select "Edit Channel" > "Integrations" > "Webhooks"
  3. Create a webhook and copy the URL

#### Email

- **SMTP Settings**:
  - Host: Your SMTP server (e.g., smtp.gmail.com)
  - Port: Usually 587 for TLS or 465 for SSL
  - Username: Your email address
  - Password: Your email password or app-specific password
  - From Email: Sender email address

### Step 4: Test Connection

Click the **"Test Connection"** button to verify your credentials work correctly.

### Step 5: Activate Tool

Toggle the **Active/Inactive** switch to enable the tool for use in events.

## Creating Tool Action Events

### Method 1: From Events Page

1. Go to **Dashboard > Events**
2. Click **"New Event"**
3. Select **"Tool Action"** as the event type
4. Choose your configured tool
5. Select an action from the dropdown
6. Fill in the required parameters
7. Set your schedule (cron, interval, or manual)
8. Save the event

### Method 2: From Tools Dashboard

1. Go to **Dashboard > Tools**
2. Browse available actions
3. Click **"Create Event"** on any action card
4. The event form will pre-populate with your selection

### Configuring Action Parameters

Each action has specific parameters. Common examples:

#### Slack - Send Message

- **Channel**: The channel to post to (#general, @username, etc.)
- **Text**: The message content (supports markdown)
- **Blocks**: Optional rich message blocks (JSON format with Monaco editor)
  - Supports headers, sections, fields, and more
  - See [Slack Block Kit documentation](https://api.slack.com/block-kit)

#### Discord - Send Message

- **Content**: The message text
- **Username**: Optional webhook username
- **Avatar URL**: Optional webhook avatar
- **Embeds**: Optional rich embeds (JSON format with Monaco editor)
  - Supports title, description, fields, images, and colors
  - See [Discord Embed documentation](https://discord.com/developers/docs/resources/channel#embed-object)

#### Email - Send Email

- **To**: Recipient email addresses (comma-separated)
- **Subject**: Email subject line
- **Body**: Email content (HTML supported with Monaco editor)
  - Full HTML formatting available
  - Syntax highlighting for easier editing

### Using Variables

You can use Cronium variables in your parameters:

- `{{USER_EMAIL}}` - Current user's email
- `{{TIMESTAMP}}` - Current timestamp
- `{{EVENT_NAME}}` - Name of the executing event
- Custom variables you've defined

## Using the Tools Dashboard

Access the Tools Dashboard at **Dashboard > Tools**.

### Browse Actions Tab

- **Search**: Find actions by name or description
- **Filter by Category**: Communication, Productivity, Data, etc.
- **Quick Actions**: Create events directly from action cards
- **Test Actions**: Try actions before creating events

### Execution History Tab

- **Real-time Logs**: See executions as they happen
- **Status Indicators**: Success (green) or failure (red)
- **Execution Time**: Performance metrics for each run
- **Filtering**: Filter by tool type or status

### Health Overview Tab

- **Tool Status**: See which tools are active/inactive
- **Execution Metrics**: Today's execution count and success rate
- **Average Response Time**: Performance tracking
- **Tool Health Grid**: Visual status of all configured tools

## Supported Tools

### Communication

- **Slack**: Send rich messages with Block Kit support
- **Discord**: Send messages with embeds and custom avatars
- **Email**: Send HTML emails
- **Microsoft Teams**: Send messages and adaptive cards

### Productivity

- **Notion**: Create pages, update databases, search content, manage blocks
- **Trello**: Create cards, move cards, add checklists
- **Google Sheets**: Read data, write data, create sheets

### Development

- **Webhook**: Send HTTP requests (GET, POST, PUT, DELETE, PATCH) to any endpoint

## Advanced Features

### Monaco Editor for Rich Content

When configuring actions with JSON or HTML fields, Cronium provides the Monaco editor:

- **JSON Fields** (Slack blocks, Discord embeds, Teams cards):
  - Syntax highlighting and validation
  - Auto-completion for common patterns
  - Format/beautify with Ctrl+Shift+F
  - Error detection with helpful messages
- **HTML Fields** (Email bodies):
  - HTML syntax highlighting
  - Tag auto-completion
  - Preview formatting

### Using in Workflows

Tool actions can be part of multi-step workflows:

1. Create a workflow
2. Add a tool action step
3. Use output from previous steps as input
4. Chain multiple tool actions together

### Conditional Execution

Set up tool actions to run based on conditions:

- On success of another event
- On failure for notifications
- Based on data values

### Batch Operations

Some tools support batch operations:

- Send multiple messages
- Update multiple records
- Process lists of items

### Error Handling

- **Automatic Retries**: Failed actions retry with exponential backoff
- **Circuit Breakers**: Prevent cascade failures
- **Error Notifications**: Get alerted on failures

## Troubleshooting

### Common Issues

#### "Tool not found" Error

- Ensure the tool is created and active
- Check that you have access to the tool
- Verify the tool hasn't been deleted

#### "Invalid credentials" Error

- Re-enter your credentials
- Generate new tokens/webhooks if needed
- Check for expired API keys

#### "Rate limit exceeded" Error

- Wait before retrying
- Check your service's rate limits
- Consider upgrading your plan

#### Messages Not Appearing

- Verify webhook URL is correct
- Check channel/recipient permissions
- Look for service-specific requirements

### Debugging Steps

1. Check **Execution History** for error details
2. Use **Test Connection** to verify credentials
3. Review action parameters for typos
4. Check service documentation for requirements

## Best Practices

### Security

- **Rotate credentials regularly**: Update webhooks/API keys periodically
- **Use least privilege**: Only grant necessary permissions
- **Monitor access**: Review audit logs regularly
- **Secure channels**: Use private channels for sensitive data

### Performance

- **Batch when possible**: Group similar operations
- **Set appropriate timeouts**: Don't wait too long for responses
- **Monitor execution times**: Identify slow operations
- **Use caching**: For read-heavy operations

### Organization

- **Naming conventions**: Use descriptive names for tools and events
- **Tag events**: Make them easy to find and filter
- **Document purpose**: Add descriptions to events
- **Group by function**: Organize tools by team or purpose

### Monitoring

- **Regular health checks**: Review Tools Dashboard daily
- **Set up alerts**: Get notified of failures
- **Track metrics**: Monitor success rates and performance
- **Review logs**: Check for patterns in errors

## Examples

### Daily Standup Reminder

```
Tool: Slack
Action: Send Message
Channel: #engineering
Message: @channel Daily standup in 15 minutes! 🚀
Schedule: Cron - "0 9 * * 1-5" (9 AM weekdays)
```

### Error Notification

```
Tool: Email
Action: Send Email
To: ops-team@company.com
Subject: [ALERT] Job {{EVENT_NAME}} Failed
Body: The scheduled job failed at {{TIMESTAMP}}. Please investigate.
Trigger: On failure of critical job
```

### Weekly Report with Rich Embed

```
Tool: Discord
Action: Send Message
Content: @here Weekly report is ready!
Embeds: [
  {
    "title": "Weekly Statistics",
    "description": "Performance summary for week {{WEEK_NUMBER}}",
    "color": 5763719,
    "fields": [
      {
        "name": "Orders Processed",
        "value": "{{WEEKLY_COUNT}}",
        "inline": true
      },
      {
        "name": "Success Rate",
        "value": "{{SUCCESS_RATE}}%",
        "inline": true
      }
    ],
    "footer": {
      "text": "Generated by Cronium"
    }
  }
]
Schedule: Cron - "0 10 * * 1" (10 AM Mondays)
```

### Slack Block Kit Example

```
Tool: Slack
Action: Send Message
Channel: #team-updates
Text: Daily standup reminder
Blocks: [
  {
    "type": "header",
    "text": {
      "type": "plain_text",
      "text": "Daily Standup Time! 🚀"
    }
  },
  {
    "type": "section",
    "text": {
      "type": "mrkdwn",
      "text": "*Please share:*\n• What you did yesterday\n• What you're doing today\n• Any blockers"
    }
  }
]
Schedule: Cron - "0 9 * * 1-5" (9 AM weekdays)
```

## Getting Help

- **Documentation**: Check this guide and tool-specific docs
- **Tools Dashboard**: Use built-in help and examples
- **Support**: Contact support for account-specific issues
- **Community**: Share tips and get help from other users

---

**Remember**: Tool Actions make automation accessible to everyone. Start simple, test thoroughly, and build complexity as needed. Happy automating! 🚀
