# Conditional Actions Documentation

This document provides a comprehensive overview of how conditional actions are implemented, stored, and executed in the Cronium system.

## Overview

Conditional actions are automated actions that are triggered based on the outcome of event execution. They allow users to create complex workflows where one event can automatically trigger other actions when it succeeds, fails, or under specific conditions.

## Types of Conditional Actions

- Triggered when the parent event completes successfully (exit code 0)
- Common use cases: Send success notifications, trigger dependent scripts

### 2. **ON_FAILURE** - Failure Actions

- Triggered when the parent event fails (non-zero exit code, timeout, or error)
- Common use cases: Send error alerts, trigger recovery scripts

### 3. **ALWAYS** - Always Actions

- Triggered regardless of parent event success or failure
- Common use cases: Cleanup operations, logging, monitoring

### 4. **ON_CONDITION** - Conditional Actions
<<<<<<< HEAD
=======

>>>>>>> main
- Triggered based on custom conditions evaluated from event output
- Currently implemented but condition evaluation logic is minimal

## Action Types

Each conditional action can perform one of two action types:

### **SCRIPT** - Trigger Another Event

- Executes another event in the system
- Uses `targetEventId` to specify which event to trigger
- Prevents infinite loops by tracking executing events

### **SEND_MESSAGE** - Send Messages

- Sends messages via email, Slack, or Discord
- Uses tool credentials or system SMTP for email
- Supports template processing with Handlebars syntax

## Database Schema

### ConditionalActions Table Structure

```sql
CREATE TABLE conditional_actions (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,                    -- ConditionalActionType enum
  value VARCHAR(255),                           -- Legacy field (unused)
  success_event_id INTEGER REFERENCES events(id),
  fail_event_id INTEGER REFERENCES events(id),
  always_event_id INTEGER REFERENCES events(id),
  condition_event_id INTEGER REFERENCES events(id),
  target_event_id INTEGER REFERENCES events(id), -- For SCRIPT actions
  tool_id INTEGER REFERENCES tool_credentials(id), -- For SEND_MESSAGE actions
  message TEXT,                                 -- Message content
  email_addresses TEXT,                         -- Email recipients
  email_subject VARCHAR(255),                   -- Email subject
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Key Relationships

- **Parent Event Links**: `success_event_id`, `fail_event_id`, `always_event_id`, `condition_event_id`
- **Target Event**: `target_event_id` (for SCRIPT actions)
- **Tool Integration**: `tool_id` (for SEND_MESSAGE actions)

## Frontend Implementation

### Form Structure (ConditionalActionsSection)

The conditional actions UI allows users to:

1. **Select Trigger Type**: ON_SUCCESS, ON_FAILURE, ALWAYS, ON_CONDITION
2. **Choose Action Type**: SCRIPT or SEND_MESSAGE
3. **Configure Action Details**:
   - For SCRIPT: Select target event from dropdown
   - For SEND_MESSAGE: Choose tool type, credentials, and compose message

### Data Flow

```typescript
// Frontend form data structure
interface ConditionalAction {
  type: "ON_SUCCESS" | "ON_FAILURE" | "ALWAYS" | "ON_CONDITION";
  action: ConditionalActionType; // SCRIPT or SEND_MESSAGE
  emailAddresses?: string;
  emailSubject?: string;
  targetEventId?: number | null;
  toolId?: number;
  toolType?: string;
  message?: string;
}

// Transformed for API submission
const conditionalActionsForSubmission = conditionalActions.map((action) => ({
  type: action.type,
  action: action.action,
  details: {
    emailAddresses: action.emailAddresses || "",
    emailSubject: action.emailSubject || "",
    targetEventId: action.targetEventId || null,
    toolId: action.toolId || null,
    message: action.message || "",
  },
}));
```

## Backend Processing

### tRPC Event Creation/Update

```typescript
// events.ts router handles conditional actions
if (input.onSuccessActions && input.onSuccessActions.length > 0) {
  for (const conditionalEvent of input.onSuccessActions) {
    await storage.createAction({
      type: conditionalEvent.type as ConditionalActionType,
      value: conditionalEvent.value,
      successEventId: conditionalEvent.targetScriptId,
      conditionEventId: event.id,
    });
  }
}
```

**Note**: The current tRPC implementation has a mismatch - it only uses basic fields from the schema and ignores the rich `details` object from the frontend.

## Execution Flow

### 1. Event Execution Entry Points

```typescript
// From scheduler.ts
const result = await executeScript(
  event,
  this.executingEvents,
  this.handleSuccessActions.bind(this),
  this.handleFailureActions.bind(this),
  this.handleAlwaysActions.bind(this),
  this.handleConditionActions.bind(this),
  this.handleExecutionCount.bind(this),
  input,
  workflowId,
);
```

### 2. Conditional Action Handlers

Located in `src/lib/scheduler/event-handlers.ts`:

```typescript
// Success handler
export async function handleSuccessActions(
  eventId: number,
  processEventCallback: Function,
) {
  const successEvents = await storage.getSuccessActions(eventId);
  for (const condEvent of successEvents) {
    await processEventCallback(condEvent, event, true, executionData);
  }
}

// Similar for handleFailureActions, handleAlwaysActions, handleConditionActions
```

### 3. Event Processing Logic

```typescript
export async function processEvent(
  conditional_event: any,
  event: any,
  isSuccess: boolean,
  executionData?: ExecutionData,
) {
  // Handle SEND_MESSAGE actions
  if (conditional_event.type === "SEND_MESSAGE" && conditional_event.message) {
    // Get tool credentials or system SMTP
    // Process templates with Handlebars
    // Send via email/Slack/Discord
  }

  // Handle SCRIPT actions
  if (conditional_event.type === "SCRIPT" && conditional_event.targetEventId) {
    // Trigger target event execution
    // Prevent infinite loops
  }
}
```

## Template Processing

### Available Variables

Conditional action messages support Handlebars templating with these variables:

```javascript
const templateContext = {
  // Event information
  event: {
    id: event.id,
    name: event.name,
    status: isSuccess ? "success" : "failure",
    duration: executionData?.duration,
    executionTime: executionData?.executionTime,
    server: event.server || "Local",
    output: executionData?.output,
    error: executionData?.error,
  },

  // User variables
  variables: {
    /* user-defined variables */
  },

  // Input data
  input: {
    /* event input data */
  },

  // Output data
  output: {
    /* event output data */
  },
};
```

### Template Examples

```handlebars
<!-- Success notification -->
Event "{{event.name}}" completed successfully! Duration:
{{event.duration}}ms Output:
{{event.output}}

<!-- Failure notification -->
❌ Event "{{event.name}}" failed Error:
{{event.error}}
Server:
{{event.server}}
```

## Storage Layer

### Key Storage Methods

```typescript
// Query methods
await storage.getSuccessActions(eventId);
await storage.getFailActions(eventId);
await storage.getAlwaysActions(eventId);
await storage.getConditionActions(eventId);

// Mutation methods  
await storage.createAction(insertConditionalAction);
await storage.deleteActionsByEventId(eventId);
```

### Database Queries

```sql
-- Get success events for an event
SELECT * FROM conditional_actions 
WHERE success_event_id = $1;

-- Get failure events for an event
SELECT * FROM conditional_actions
WHERE fail_event_id = $1;

-- Get always events for an event  
SELECT * FROM conditional_actions
WHERE always_event_id = $1;

-- Get condition events for an event
SELECT * FROM conditional_actions
WHERE condition_event_id = $1;
```

## Message Sending Implementation

### Email via System SMTP

```typescript
if (conditional_event.toolId === null) {
  // Use system SMTP settings
  const systemSmtp = await getSmtpSettings();
  credentials = {
    host: systemSmtp.host,
    port: systemSmtp.port,
    user: systemSmtp.user,
    password: systemSmtp.password,
    fromEmail: systemSmtp.fromEmail,
    fromName: systemSmtp.fromName,
  };
  toolType = "EMAIL";
}
```

### Email via Tool Credentials

```typescript
else {
  // Get tool credentials from database
  const tool = await db.select()
    .from(toolCredentials)
    .where(eq(toolCredentials.id, conditional_event.toolId));

  // Decrypt credentials
  credentials = JSON.parse(encryptionService.decrypt(tool.credentials));
  toolType = tool.type;
}
```

### Message Processing

```typescript
// Process templates
const processedSubject = templateProcessor.processTemplate(
  subject,
  templateContext,
);
const processedMessage = templateProcessor.processHtmlTemplate(
  message,
  templateContext,
);

// Send email
const emailMessage = {
  to: recipients,
  subject: processedSubject,
  text: processedMessage.replace(/<[^>]*>/g, ""), // Strip HTML
  html: processedMessage,
};

const emailSent = await sendEmail(emailMessage, smtpCredentials);
```

## Security Considerations

### Infinite Loop Prevention

```typescript
// Track executing events to prevent loops
const executingEvents = new Set<number>();

if (executingEvents.has(targetEventId)) {
  console.log(
    `Skipping event ${targetEventId} - already executing (loop prevention)`,
  );
  return;
}

executingEvents.add(targetEventId);
// Execute event...
executingEvents.delete(targetEventId);
```

### Credential Security

- Tool credentials are encrypted in the database
- Decryption only happens during execution
- System SMTP settings are stored as encrypted system settings

## Current Issues & Limitations

### 1. **Frontend/Backend Mismatch**

- Frontend sends rich `details` object with all conditional action data
- Backend tRPC router ignores `details` and only uses basic schema fields
- Results in lost data for `toolId`, `message`, `emailAddresses`, etc.

### 2. **Legacy Fields**

- `sendEmail` field in frontend form submission is unused
- `value` field in database schema appears to be legacy/unused
- Some field mappings don't align between frontend and backend

### 3. **Condition Evaluation**

- ON_CONDITION actions are partially implemented
- No sophisticated condition evaluation logic
- Limited to basic boolean conditions

### 4. **Tool Integration**

- Only email, Slack, and Discord are supported
- Plugin system exists but isn't fully utilized for conditional actions
- Limited error handling for tool failures

## Recommendations

### 1. **Fix Frontend/Backend Mismatch**

```typescript
// Backend should process the full details object
const conditionalEventData = {
  type: conditionalEvent.action, // Use action, not type
  successEventId: eventId,
  targetEventId: conditionalEvent.details.targetEventId,
  toolId: conditionalEvent.details.toolId,
  message: conditionalEvent.details.message,
  emailAddresses: conditionalEvent.details.emailAddresses,
  emailSubject: conditionalEvent.details.emailSubject,
};
```

### 2. **Remove Legacy Fields**

- Remove unused `sendEmail` field from frontend
- Clarify purpose of `value` field or remove it
- Align field names between frontend and backend

### 3. **Enhance Condition Logic**

```typescript
// Add sophisticated condition evaluation
const conditionResult = evaluateCondition(
  conditional_event.condition,
  executionData,
);
if (conditionResult) {
  await processEventCallback(condEvent, event, true);
}
```

### 4. **Improve Error Handling**

- Add retry logic for failed message sending
- Better error reporting in UI
- Graceful degradation when tools are unavailable

## Examples

### Creating a Success Notification

```typescript
const conditionalAction = {
  type: "ON_SUCCESS",
  action: ConditionalActionType.SEND_MESSAGE,
  toolType: "EMAIL",
  toolId: 1, // Email credential ID
  emailAddresses: "admin@example.com",
  emailSubject: "✅ {{event.name}} completed successfully",
  message: `
    <h2>Event Success</h2>
    <p><strong>Event:</strong> {{event.name}}</p>
    <p><strong>Duration:</strong> {{event.duration}}ms</p>
    <p><strong>Output:</strong></p>
    <pre>{{event.output}}</pre>
  `,
};
```

### Creating a Failure Recovery Script

```typescript
const conditionalAction = {
  type: "ON_FAILURE",
  action: ConditionalActionType.SCRIPT,
  targetEventId: 123, // ID of recovery script
};
```

<<<<<<< HEAD
This documentation provides a complete picture of how conditional actions work in the Cronium system, from user interface to database storage to execution flow.
=======
This documentation provides a complete picture of how conditional events work in the Cronium system, from user interface to database storage to execution flow.
>>>>>>> main
