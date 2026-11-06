# Cronium Node.js SDK

Runtime SDK for Node.js scripts in Cronium, in a container or on a remote server. In both, `cronium` is already available to a script as a global, and `require("cronium")` works too.

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

// Run a tool action
const rows = await cronium.executeToolAction("SQL", "run-query", {
  query: "SELECT 1",
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

> **Note:** `executeToolAction` takes the type of a saved tool connection and the
> action's ID. It runs against the event owner's connection of that type, and the
> most recently created one if there are several.
>
> The `sendEmail`/`sendSlackMessage`/`sendDiscordMessage` wrappers **currently
> fail**, in a container and on a remote server. They send a lowercase tool type,
> the action ID `send_message`, and parameter names those tools do not recognize.
