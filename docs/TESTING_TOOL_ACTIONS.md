# Testing Tool Actions with Real Services

This guide explains how to test Tool Actions with real Slack and Discord webhooks.

## Prerequisites

1. Active Cronium instance with database connection
2. Slack or Discord webhook URLs
3. Access to the channels where messages will be sent

## Setting Up Webhooks

### Slack Webhook Setup

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Create a new app or select an existing one
3. Navigate to "Incoming Webhooks" in the sidebar
4. Toggle "Activate Incoming Webhooks" to On
5. Click "Add New Webhook to Workspace"
6. Select the channel where messages should be posted
7. Copy the webhook URL (format: `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX`)

### Discord Webhook Setup

1. Open Discord and navigate to your server
2. Right-click on the channel where you want messages
3. Select "Edit Channel" > "Integrations" > "Webhooks"
4. Click "New Webhook"
5. Give it a name and optionally upload an avatar
6. Copy the webhook URL (format: `https://discord.com/api/webhooks/000000000000000000/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`)

## Configuring Tools in Cronium

### Via Dashboard

1. Navigate to Dashboard > Settings > Tools
2. Click "Add Tool"
3. Select either Slack or Discord
4. Enter:
   - **Name**: A descriptive name (e.g., "Team Slack", "Dev Discord")
   - **Webhook URL**: The URL you copied from Slack/Discord
   - For Slack, optionally set default channel and username
5. Click "Test Connection" to verify
6. Save and ensure the tool is Active

### Via API

```bash
# Example: Add a Slack tool via API
curl -X POST http://localhost:5001/api/trpc/tools.create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Team Slack",
    "type": "SLACK",
    "credentials": {
      "webhookUrl": "https://hooks.slack.com/services/...",
      "channel": "#general",
      "username": "Cronium Bot"
    },
    "isActive": true
  }'
```

## Running Tests

### Using the Test Script

```bash
# Check configured tools
npx tsx src/scripts/check-configured-tools.ts

# Run the real tools test (will send actual messages)
npx tsx src/scripts/test-real-tools.ts
```

The test script will:

1. Find all active Slack/Discord tools
2. Create test events for each
3. Execute them and send real messages
4. Log the results

### Manual Testing via Dashboard

1. Go to Dashboard > Tools
2. In the "Browse Actions" tab, find the action you want to test
3. Click "Create Event"
4. Fill in the parameters:
   - **Slack**: Channel and message text
   - **Discord**: Message content
5. Set trigger to "Manual"
6. Save and click "Run Now"

### Testing via API Endpoint

```bash
# Test a specific tool
curl -X POST http://localhost:5001/api/test-tool-action \
  -H "Content-Type: application/json" \
  -d '{
    "toolId": 123,
    "actionId": "slack.send-message",
    "parameters": {
      "channel": "#test",
      "message": "Test message from API"
    }
  }'
```

## Expected Results

### Successful Slack Message

You should see a message in your Slack channel with:

- The text you specified
- Posted by the webhook bot
- In the channel you specified

### Successful Discord Message

You should see a message in your Discord channel with:

- The content you specified
- Posted by the webhook bot
- With the webhook's name and avatar (if configured)

## Monitoring Results

### Via Dashboard

1. Go to Dashboard > Tools > Execution History
2. Look for your test executions
3. Check status (SUCCESS/FAILURE)
4. View execution time and any error messages

### Via Database

```sql
-- View recent tool action logs
SELECT * FROM tool_action_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Check audit logs
SELECT * FROM tool_audit_logs
WHERE action = 'execute'
AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

## Troubleshooting

### "Tool not found" Error

- Ensure the tool is created and active
- Check that you're using the correct tool ID

### "Invalid webhook URL" Error

- Verify the webhook URL is correct and complete
- Test the webhook directly using curl:

  ```bash
  # Slack
  curl -X POST -H 'Content-type: application/json' \
    --data '{"text":"Hello World!"}' \
    YOUR_WEBHOOK_URL

  # Discord
  curl -X POST -H 'Content-type: application/json' \
    --data '{"content":"Hello World!"}' \
    YOUR_WEBHOOK_URL
  ```

### Messages Not Appearing

- Check the webhook URL is for the correct channel
- Verify the bot has permissions to post
- Look for rate limiting (especially for Discord)
- Check execution logs for error details

### Rate Limiting

- Slack: 1 message per second per webhook
- Discord: 30 requests per minute per webhook
- The system automatically handles rate limits with retries

## Best Practices

1. **Test Channel**: Use a dedicated test channel to avoid spam
2. **Rate Limits**: Don't run tests too frequently
3. **Error Handling**: Always check execution logs for failures
4. **Webhook Security**: Keep webhook URLs secure and rotate them periodically
5. **Monitoring**: Set up alerts for failed executions

## Example Test Messages

### Slack Examples

```json
{
  "channel": "#test",
  "message": "🚀 Test message from Cronium Tool Actions",
  "username": "Cronium Bot",
  "icon_emoji": ":robot_face:"
}
```

### Discord Examples

```json
{
  "content": "🚀 Test message from Cronium Tool Actions\n**Status**: All systems operational\n*Timestamp*: {{TIMESTAMP}}"
}
```

## Next Steps

After successful testing:

1. Create production events with proper schedules
2. Set up error notifications
3. Monitor execution metrics
4. Configure rate limits and quotas
5. Enable credential encryption for security

---

For more information, see:

- [Tool Actions User Guide](./TOOL_ACTIONS_GUIDE.md)
- [Tool Actions API Reference](./api/TOOL_ACTIONS_API.md)
- [Troubleshooting Guide](./TOOL_ACTIONS_GUIDE.md#troubleshooting)
