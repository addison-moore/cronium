# Cronium Python SDK

Runtime SDK for Python scripts in Cronium, in a container or on a remote server. In both, `cronium` is already available to a script, and `import cronium` works too.

## Installation

```bash
pip install cronium
```

For async support:

```bash
pip install cronium[async]
```

## Usage

```python
import cronium

# Get input data
data = cronium.input()

# Process data
result = process_data(data)

# Set output
cronium.output(result)

# Work with variables
cronium.set_variable("last_run", datetime.now().isoformat())
last_run = cronium.get_variable("last_run")

# Run a tool action
rows = cronium.execute_tool_action("SQL", "run-query", {"query": "SELECT 1"})
```

> **Note:** `execute_tool_action` takes the type of a saved tool connection and
> the action's ID. It runs against the event owner's connection of that type, and
> the most recently created one if there are several.
>
> The `send_email`/`send_slack_message`/`send_discord_message` wrappers **currently
> fail**, in a container and on a remote server. They send a lowercase tool type,
> the action ID `send_message`, and parameter names those tools do not recognize.

## Async Usage

```python
import asyncio
from cronium import AsyncCronium

async def main():
    async with AsyncCronium() as cronium:
        data = await cronium.input()
        # Process asynchronously
        await cronium.output(result)

asyncio.run(main())
```
