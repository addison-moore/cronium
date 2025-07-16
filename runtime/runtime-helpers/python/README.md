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
