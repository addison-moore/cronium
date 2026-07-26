# Cronium Python SDK

Runtime SDK for Cronium containerized script execution.

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

# Send notifications
cronium.send_email(
    to="admin@example.com",
    subject="Task Complete",
    body=f"Processed {len(result)} items"
)
```

> **Note:** the tool-action helpers (`execute_tool_action` and the
> `send_email`/`send_slack_message`/`send_discord_message` wrappers) run against
> the tool connection of the given type belonging to the event's owner. If you
> have more than one connection of a type, the most recently created one is used.

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
