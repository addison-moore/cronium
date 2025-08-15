# Claude Code Configuration for Cronium

This directory contains Claude Code configuration files to enhance the development experience.

## Configuration Files

### `.claude/settings.json`

Main project configuration file that includes:

- Tool permissions
- Environment variables
- Hook configurations for logging and suggestions
- Project-wide settings

### `.claude/settings.local.json`

Personal settings (git-ignored) for individual preferences:

- Personal environment variables
- Custom hook configurations
- User-specific settings

## Hooks

### Pre-Tool Hooks

- **File Operation Warnings**: Tracks rm/mv/cp commands for safety

### Post-Tool Hooks

- **Lint Suggestions**: Suggests running lint after TypeScript/JavaScript modifications
- **Syntax Checking**: Validates JavaScript/TypeScript files after edits

### Completion Hooks

- **Stop Hook**: Shows accumulated suggestions at the end of the session
- **SubagentStop Hook**: Logs subagent completion times

## Custom Commands

### Lint Management Commands

#### `/lint-status`

Check current linting status including error/warning counts and affected files.

#### `/lint-fix-parallel [max-agents]`

Start the **CONTINUOUS** parallel lint fixing workflow:

- Generates fresh lint log
- Initializes processing queue with all files
- Sets up automatic progression between files
- Each subagent automatically triggers the next file when complete

#### `/lint-spawn-all`

Spawn initial batch of subagents for continuous processing.

#### `/lint-next`

Get the next file from the continuous processing queue.

#### `/lint-progress`

Show current status and progress of continuous processing.

#### `/lint-fix-file <filepath>`

Get specific fix instructions for a single file (legacy batch mode).

### Project Commands

#### `/project/status`

Comprehensive project status including:

- Git status
- Linting summary
- TypeScript compilation status
- TODO/FIXME count
- Test file count

#### `/project/clean`

Clean build artifacts and logs:

- Removes `.next` directory
- Cleans log files
- Removes TypeScript build info

## Usage Examples

### Fix All Linting Errors (Continuous Mode)

```bash
# Initialize continuous workflow with 5 concurrent agents
/lint-fix-parallel 5

# Spawn initial batch of subagents (they auto-continue)
/lint-spawn-all

# Check progress anytime
/lint-progress

# Get next file manually if needed
/lint-next
```

### Single File Fix

```bash
# Get fix instructions for specific file
/lint-fix-file src/components/tools/ToolManager.tsx
```

### Project Maintenance

```bash
# Check overall status
/project/status

# Clean and rebuild
/project/clean
pnpm build
```

## Best Practices

1. **Concurrency**: Use 5-10 concurrent agents for optimal performance
2. **Batch Processing**: Process files with fewer errors first (quick wins)
3. **Verification**: Always run `/lint-status` after fixing to verify progress
4. **Git Commits**: Review changes with `git diff` before committing

## Activity Logs

- `.claude/activity.log`: File modification history
- `.claude/suggestions.log`: Accumulated suggestions (cleared after each session)
- `.claude/subagent.log`: Subagent completion tracking

## Environment Variables

- `CLAUDE_MAX_CONCURRENT_AGENTS`: Default number of concurrent agents (5)
- `CLAUDE_LINT_AUTO_FIX`: Enable automatic fix suggestions (true)
- `NODE_ENV`: Development environment setting
- `CLAUDE_PROJECT`: Project identifier (cronium)
