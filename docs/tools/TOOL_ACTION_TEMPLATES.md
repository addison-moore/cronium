# Tool Action Templates

Tool Action Templates allow users to create reusable configurations for tool actions in Cronium. This feature simplifies the process of creating events with similar tool actions by providing pre-configured templates.

## Overview

Templates can be created for any tool action (Discord messages, Slack notifications, emails, etc.) and can include dynamic variables using Handlebars syntax.

## Features

### Template Types

- **User Templates**: Personal templates created and managed by individual users
- **System Templates**: Pre-configured templates available to all users

### Variable Support

Templates support Handlebars variables for dynamic content:

- `{{cronium.event.name}}` - Event name
- `{{cronium.event.status}}` - Event status (success/failure)
- `{{cronium.event.output}}` - Event output
- `{{cronium.event.error}}` - Error message (if failed)
- `{{cronium.event.duration}}` - Execution duration
- `{{cronium.event.executionTime}}` - Execution timestamp
- `{{cronium.user.*}}` - User-defined variables

## Using Templates

### 1. Creating a Template

Navigate to **Tools > Templates** in the dashboard:

1. Click "New Template"
2. Select the tool type (Discord, Slack, Email, etc.)
3. Choose the specific action
4. Configure the action parameters using variables where needed
5. Give your template a descriptive name
6. Save the template

### 2. Using Templates in Events

When creating or editing an event with a tool action:

1. Select the tool and action type
2. A "Use Template" dropdown will appear if templates exist
3. Select a template to auto-fill the parameters
4. Customize the parameters if needed

### 3. Managing Templates

From the Templates page, you can:

- Edit existing templates
- Clone templates to create variations
- Delete templates you no longer need
- Search and filter templates by tool type

## Example Templates

### Discord Success Notification

```json
{
  "content": "✅ Event '{{cronium.event.name}}' completed successfully!\n\nDuration: {{cronium.event.duration}}ms\nOutput: {{cronium.event.output}}"
}
```

### Slack Error Alert

```json
{
  "text": "🚨 Event Failed: {{cronium.event.name}}\n\nError: {{cronium.event.error}}\nTime: {{cronium.event.executionTime}}"
}
```

### Email Report

```json
{
  "to": "{{cronium.user.adminEmail}}",
  "subject": "Cronium Event Report: {{cronium.event.name}}",
  "body": "Event Status: {{cronium.event.status}}\n\nDetails:\n- Duration: {{cronium.event.duration}}ms\n- Time: {{cronium.event.executionTime}}\n\nOutput:\n{{cronium.event.output}}"
}
```

## System Templates

Cronium includes several pre-configured system templates:

### Discord Templates

- **Success Notification**: Green embed with event details
- **Error Alert**: Red embed with error information
- **Daily Report**: Summary embed with statistics

### Slack Templates

- **Success Message**: Simple success notification
- **Error Alert**: Formatted error message
- **Status Update**: Generic status update

### Email Templates

- **Event Success**: Success notification email
- **Event Failure**: Failure alert with error details
- **Daily Summary**: Daily report with statistics

## Best Practices

1. **Use descriptive names**: Name templates clearly to indicate their purpose
2. **Include descriptions**: Add descriptions to help others understand the template's use case
3. **Test templates**: Use the preview feature to test templates with sample data
4. **Leverage variables**: Use variables to make templates flexible and reusable
5. **Clone and customize**: Start with system templates and customize for your needs

## Technical Details

### Database Schema

Templates are stored in the `tool_action_templates` table with:

- User association for ownership
- Tool type and action ID
- Parameters stored as JSONB
- System template flag
- Timestamps for tracking

### Template Processing

- Templates are processed using Handlebars.js
- Variables are replaced at event execution time
- Nested object support for complex data structures
- Safe evaluation prevents code injection

## API Reference

### tRPC Endpoints

- `toolActionTemplates.create` - Create a new template
- `toolActionTemplates.update` - Update existing template
- `toolActionTemplates.delete` - Delete a template
- `toolActionTemplates.getById` - Get single template
- `toolActionTemplates.getByToolAction` - Get templates for specific tool/action
- `toolActionTemplates.getUserTemplates` - Get user's templates
- `toolActionTemplates.getSystemTemplates` - Get system templates
- `toolActionTemplates.clone` - Clone an existing template
