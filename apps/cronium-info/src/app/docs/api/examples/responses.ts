// Response bodies shown in the API documentation. They are objects, not strings,
// so the contract test can check their fields against the database schema.

const eventColumns = {
  id: 42,
  userId: "user_123",
  name: "Nightly backup",
  description: "Back up the database",
  shared: false,
  type: "BASH",
  content: 'echo "Starting backup"',
  status: "ACTIVE",
  triggerType: "SCHEDULE",
  scheduleNumber: 1,
  scheduleUnit: "MINUTES",
  customSchedule: "0 2 * * *",
  timezone: "UTC",
  overlapPolicy: "SKIP",
  runLocation: "LOCAL",
  serverId: null,
  timeoutValue: 5,
  timeoutUnit: "MINUTES",
  retries: 1,
  maxExecutions: 0,
  executionCount: 12,
  successCount: 11,
  failureCount: 1,
  lastRunAt: "2026-11-04T02:00:00.000Z",
  nextRunAt: "2026-11-05T02:00:00.000Z",
  tags: ["backup"],
  createdAt: "2026-10-01T09:30:00.000Z",
  updatedAt: "2026-11-04T02:00:04.000Z",
};

const logColumns = {
  id: 1001,
  eventId: 42,
  workflowId: null,
  jobId: "job_Byl2WgC1kGC1",
  status: "SUCCESS",
  output: "Starting backup\n",
  error: null,
  startTime: "2026-11-04T02:00:00.000Z",
  endTime: "2026-11-04T02:00:04.000Z",
  duration: 4210,
  executionDuration: 3890,
  setupDuration: 320,
  retries: 0,
  eventName: "Nightly backup",
  eventType: "BASH",
  userId: "user_123",
  createdAt: "2026-11-04T02:00:00.000Z",
  updatedAt: "2026-11-04T02:00:04.000Z",
};

const serverFields = {
  id: 7,
  userId: "user_123",
  name: "Production",
  address: "203.0.113.10",
  username: "deploy",
  port: 22,
  sshHostKey: "SHA256:Tm9uZSBvZiB0aGlzIGlzIHJlYWw",
  shared: false,
  online: true,
  lastChecked: "2026-11-04T01:55:00.000Z",
  isArchived: false,
  hasPrivateKey: true,
  hasPassword: false,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-11-04T01:55:00.000Z",
};

export const responseExamples = {
  eventRun: {
    success: true,
    logId: 1001,
    jobId: "job_Byl2WgC1kGC1",
  },

  workflowRun: {
    success: true,
    executionId: 88,
    status: "RUNNING",
  },

  eventList: [
    {
      ...eventColumns,
      eventServers: [],
      secretFieldsRedacted: false,
    },
  ],

  event: {
    ...eventColumns,
    envVars: [
      {
        id: 3,
        eventId: 42,
        key: "BACKUP_BUCKET",
        value: "nightly-backups",
        createdAt: "2026-10-01T09:30:00.000Z",
        updatedAt: "2026-10-01T09:30:00.000Z",
      },
    ],
    server: null,
    servers: [],
    secretFieldsRedacted: false,
  },

  logList: {
    logs: [{ ...logColumns, workflowName: null }],
    total: 45,
    page: 1,
    pageSize: 20,
    totalPages: 3,
  },

  log: {
    ...logColumns,
    scriptContent: 'echo "Starting backup"',
  },

  serverList: [serverFields],

  server: serverFields,

  serverDeleted: { message: "Server deleted successfully" },
};

export const errorExamples = {
  general: { error: "Access denied" },

  validation: {
    error: "Validation failed",
    details: {
      _errors: ['Unrecognized key: "script"'],
      timeoutValue: { _errors: ["Too small: expected number to be >=1"] },
    },
  },

  unknownRoute: {
    error: "Not Found",
    message: "API endpoint '/api/does-not-exist' does not exist",
    statusCode: 404,
    timestamp: "2026-11-04T16:15:00.000Z",
  },
};
