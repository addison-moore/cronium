# Parallel Lint Fix Workflow

This document explains how to use Claude Code to fix linting errors across multiple files in parallel.

## Overview

When you have many linting errors across multiple files, you can use Claude Code's Task tool to spawn multiple subagents that work in parallel to fix issues systematically.

## Setup

1. **Generate lint log**:

   ```bash
   pnpm lint > lint.log 2>&1
   ```

2. **Analyze and create execution plan**:
   ```bash
   python3 scripts/lint-fix-orchestrator.py --max-concurrent 5 --output lint-fix-plan.json
   ```

## Configuration Options

- `--max-concurrent`: Maximum number of subagents running simultaneously (default: 5)
- `--lint-log`: Path to the lint log file (default: lint.log)
- `--output`: Save execution plan to JSON file
- `--summary`: Show only summary without detailed batch information

## How It Works

1. **Parse Lint Log**: The orchestrator parses the ESLint output and groups errors by file
2. **Prioritize Files**: Files are sorted by error count (fewer errors first for quick wins)
3. **Create Batches**: Files are grouped into batches based on max concurrent limit
4. **Generate Instructions**: Each file gets detailed fix instructions based on error types

## Example Workflow

### Step 1: Analyze Current Linting Errors

```bash
# Generate fresh lint log
pnpm lint > lint.log 2>&1

# Create execution plan
python3 scripts/lint-fix-orchestrator.py --max-concurrent 5 --output lint-fix-plan.json
```

### Step 2: Process Files in Batches

For each batch in the execution plan, you can use Claude Code's Task tool to fix files in parallel:

```
# Example for processing first batch (5 files)
# Each subagent receives specific instructions for their assigned file
```

### Step 3: Verify Fixes

```bash
# After each batch, verify progress
pnpm lint

# Check specific files if needed
pnpm lint src/components/tools/__tests__/*.tsx
```

## Error Type Handling

The orchestrator provides specific fix instructions for common error patterns:

- **Unused variables** (`@typescript-eslint/no-unused-vars`): Remove or prefix with `_`
- **Unbound methods** (`@typescript-eslint/unbound-method`): Use arrow functions or add `this: void`
- **Type safety** (`@typescript-eslint/no-unsafe-*`): Add proper type annotations
- **Template expressions** (`@typescript-eslint/restrict-template-expressions`): Ensure proper types

## Best Practices

1. **Start Small**: Process files with fewer errors first
2. **Batch Size**: 5-10 concurrent agents is usually optimal
3. **Verification**: Run lint after each batch to track progress
4. **Review Changes**: Check git diff before committing fixes

## Monitoring Progress

The execution plan JSON includes:

- Total files and error counts
- Batch organization
- Specific instructions for each file
- Priority ordering

## Example Output

```json
{
  "configuration": {
    "max_concurrent_agents": 5,
    "total_files": 80,
    "total_errors": 817,
    "total_warnings": 316,
    "total_batches": 16
  },
  "batches": [
    {
      "batch_number": 1,
      "files_count": 5,
      "total_issues": 5,
      "tasks": [...]
    }
  ]
}
```

## Troubleshooting

- If a file has too many errors, consider fixing it manually first
- For complex type errors, you may need to update type definitions
- Some errors may require architectural changes beyond simple fixes
