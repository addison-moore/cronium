# Phase 3.3 Scheduling - Summary

## Completed Analysis

### 1. Cron Scheduling ✅

**Current Implementation:**

- Uses `node-schedule` library with RecurrenceRule or cron patterns
- Supports custom cron expressions via `customSchedule` field
- Handles various time units: SECONDS, MINUTES, HOURS, DAYS

**Key Findings:**

- **scheduled_for field**: Always set to current time for recurring jobs
- **Recurring execution**: Handled by node-schedule, creates new job on each trigger
- **Cron validation**: Custom schedules are parsed and validated
- **Next execution**: Calculated and stored in `nextRunAt` field

**How it works:**

```javascript
// Cron pattern creates recurring triggers
scheduleJob("0 */5 * * * *", () => {
  // Create immediate job for execution
  executeScript(event); // This creates a job with scheduledFor = now
});
```

### 2. Timezone Handling ✅

**Implementation:**

- Database stores all timestamps in UTC
- JavaScript Date objects handle local timezone conversion
- No explicit timezone configuration needed

**Key Points:**

- PostgreSQL `timestamp` columns store UTC
- `new Date()` creates local time, converted to UTC on storage
- Retrieved dates are in UTC, converted to local on display
- Consistent behavior across different timezones

### 3. One-time Scheduling ✅

**Future Job Creation:**

- Jobs can be created with future `scheduledFor` date
- Orchestrator only claims jobs where `scheduledFor <= now`
- Supports delayed execution and scheduled tasks

**Example:**

```typescript
await jobService.createJob({
  // ... other fields
  scheduledFor: new Date("2024-01-01T09:00:00Z"), // Future date
});
```

**Job Queue Polling:**

```sql
-- Orchestrator query for eligible jobs
WHERE status = 'queued'
  AND orchestratorId IS NULL
  AND scheduledFor <= NOW()
```

## Architecture Insights

### Current Scheduling Model

1. **Recurring Events**:
   - Scheduler (node-schedule) triggers at intervals
   - Each trigger creates a new job with immediate execution
   - No pre-created future jobs for recurring events

2. **One-time Events**:
   - Can create jobs with future `scheduledFor`
   - Jobs wait in queue until scheduled time
   - Orchestrator polls and picks up when ready

3. **Benefits**:
   - Simple job model (no complex scheduling in jobs)
   - Flexible scheduling changes (update event, not jobs)
   - Efficient queue (only ready jobs are polled)

## Enhancements Made

### 1. Created job-scheduling-utils.ts

- `calculateNextExecutionTime()`: Calculate next run for events
- `createScheduledJob()`: Create jobs with future scheduling
- `createNextRecurringJob()`: Handle recurring job creation
- `validateCronExpression()`: Validate and preview cron patterns

### 2. Created test-job-scheduling.ts

- Tests cron pattern parsing
- Verifies recurring job creation
- Tests future job scheduling
- Analyzes timezone handling
- Checks job queue timing

## Key Recommendations

1. **For Recurring Events**: Continue using node-schedule triggers
2. **For Future Jobs**: Use `scheduledFor` field for delayed execution
3. **For Workflows**: Can schedule workflow start with future job
4. **For Timezone Support**: Consider adding user timezone preference

## Next Steps

The scheduling system is working correctly for containerized execution:

- Recurring events trigger job creation on schedule
- Future jobs wait in queue until scheduled time
- Orchestrator respects `scheduledFor` field
- Timezone handling is consistent

Phase 3.3 is complete. The scheduling system properly supports both recurring and one-time scheduled execution with correct job queue management.
