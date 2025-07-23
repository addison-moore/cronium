# Cronium Node.js SDK

Runtime SDK for Cronium containerized script execution.

## Installation

```bash
npm install cronium
```

## Usage

### CommonJS

```javascript
const cronium = require("cronium");

// Get input data
const data = await cronium.input();

// Process data
const result = processData(data);

// Set output
await cronium.output(result);

// Work with variables
await cronium.setVariable("last_run", new Date().toISOString());
const lastRun = await cronium.getVariable("last_run");

// Send notifications
await cronium.sendEmail({
  to: "admin@example.com",
  subject: "Task Complete",
  body: `Processed ${result.length} items`,
});
```

### ES Modules

```javascript
import { input, output, setVariable, getVariable } from "cronium";

const data = await input();
const result = processData(data);
await output(result);
```

### TypeScript

```typescript
import Cronium, { EventContext } from "cronium";

const cronium = new Cronium();

const context: EventContext = await cronium.event();
console.log(`Running event: ${context.name}`);
```

## API Reference

All methods return Promises and should be used with async/await or `.then()`.

- `input()` - Get execution input data
- `output(data)` - Set execution output data
- `getVariable(key)` - Get variable value
- `setVariable(key, value)` - Set variable value
- `setCondition(condition)` - Set workflow condition
- `event()` - Get event context metadata
- `executeToolAction(tool, action, config)` - Execute tool action
- `sendEmail(options)` - Send email
- `sendSlackMessage(options)` - Send Slack message
- `sendDiscordMessage(options)` - Send Discord message
