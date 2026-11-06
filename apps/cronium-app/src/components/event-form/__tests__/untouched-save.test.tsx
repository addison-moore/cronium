/**
 * Opening an event for editing and saving it without changing anything must
 * send back what the event already has. `events.update` takes `envVars: []` to
 * mean "delete them all", so a form that fails to load an event's variables
 * deletes them on save, and the save still reports success.
 *
 * Each place that edits an event runs here against the same `events.getById`
 * result, built by the real `toEventApiDto`, so a change to the field names on
 * either side of the form fails these tests rather than losing data.
 *
 * It all runs outside UTC, where a start time the form mixes up between UTC and
 * local time moves on every save. `lib/__tests__/start-time.test.ts` has the detail.
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { inTimeZone } from "../../../../../../tests/in-time-zone";

const mockUpdateMutateAsync = jest.fn();
const mockRefetch = jest.fn();
const mockMutation = { mutate: jest.fn(), mutateAsync: jest.fn() };
const mockLogs = { logs: [] };
const mockSocket = {
  subscribeToLog: jest.fn(),
  unsubscribeFromLog: jest.fn(),
  subscribeToLogUpdates: () => () => undefined,
};
let mockApiEvent: unknown;

jest.mock("@/lib/trpc", () => ({
  trpc: {
    events: {
      getById: {
        useQuery: () => ({
          data: mockApiEvent,
          isLoading: false,
          error: null,
          refetch: mockRefetch,
        }),
      },
      getLogs: {
        useQuery: () => ({
          data: mockLogs,
          isLoading: false,
          refetch: mockRefetch,
        }),
      },
      validateCron: { useQuery: () => ({ data: undefined }) },
      update: {
        useMutation: () => ({ mutateAsync: mockUpdateMutateAsync }),
      },
      create: { useMutation: () => mockMutation },
      delete: { useMutation: () => mockMutation },
      execute: { useMutation: () => mockMutation },
      activate: { useMutation: () => mockMutation },
      deactivate: { useMutation: () => mockMutation },
      resetCounter: { useMutation: () => mockMutation },
    },
    servers: {
      getAll: {
        useQuery: () => ({
          data: {
            servers: [{ id: 6, name: "sandbox", address: "192.0.2.10" }],
          },
          isLoading: false,
        }),
      },
      getGroups: { useQuery: () => ({ data: { groups: [] } }) },
    },
    tools: {
      getAll: {
        useQuery: () => ({
          data: { tools: [{ id: 1, name: "slack", type: "SLACK" }] },
        }),
      },
      executeAction: { useMutation: () => mockMutation },
    },
    toolActionTemplates: {
      getByToolAction: { useQuery: () => ({ data: undefined }) },
    },
    settings: {
      getEditorSettings: { useQuery: () => ({ data: undefined }) },
      updateEditorSettings: { useMutation: () => mockMutation },
    },
  },
}));

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "42" }),
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/dashboard/events/42",
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}));

jest.mock("@/hooks/use-logs-socket", () => ({
  useLogsSocket: () => mockSocket,
}));

// Stands in for AES: storage hands the API ciphertext, and only the DTO decrypts.
jest.mock("@/lib/security/field-secret", () => ({
  decryptEnvVarValue: (stored: string) => stored.replace(/^ciphertext:/, ""),
}));

// next/dynamic would load the real form a tick later, for no benefit here.
jest.mock("@/components/event-form/EventForm-lazy", () => ({
  __esModule: true,
  default: jest.requireActual<
    typeof import("@/components/event-form/EventForm")
  >("@/components/event-form/EventForm").default,
}));

jest.mock("@cronium/ui", () => {
  const actual =
    jest.requireActual<typeof import("@cronium/ui")>("@cronium/ui");
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    MonacoEditor: ({ value }: { value?: string }) =>
      ReactActual.createElement("textarea", {
        readOnly: true,
        value: value ?? "",
      }),
  };
});

jest.mock("@/components/dashboard/AIScriptAssistant-lazy", () => ({
  __esModule: true,
  default: () => null,
}));

// The rest of the details page isn't what's being tested, and needs a lot of it.
jest.mock("@/components/event-details/EventDetailsHeader", () => ({
  EventDetailsHeader: () => null,
}));
jest.mock("@/components/event-details/EventOverviewTab", () => ({
  EventOverviewTab: () => null,
}));
jest.mock("@/components/event-details/EventLogsTab", () => ({
  EventLogsTab: () => null,
}));
jest.mock("@/components/event-details/EventDeleteDialog", () => ({
  EventDeleteDialog: () => null,
}));

import EditEventPage from "@/app/dashboard/(main)/events/[id]/edit/page";
import { EventDetails } from "@/components/event-details/EventDetails";
import { EventEditModal } from "@/components/ui/event-edit-modal";
import { toEventApiDto } from "@/server/security/api-dto";
import type { EventWithRelations } from "@/server/storage";
import {
  CatchupPolicy,
  EventStatus,
  EventTriggerType,
  EventType,
  OverlapPolicy,
  RunLocation,
  TimeUnit,
  type EnvVar,
  type Server,
} from "@/shared/schema";

// Each test renders the whole form up to three times, and CI runs with coverage.
jest.setTimeout(30_000);

inTimeZone("America/Los_Angeles");

const OWNER = "owner";
const EVENT_ID = 42;

const sandbox = {
  id: 6,
  name: "sandbox",
  address: "192.0.2.10",
  sshKey: null,
  password: null,
  sshKeyPurged: false,
  passwordPurged: false,
} as Server;

/** A row as storage returns it: stored values are ciphertext, dates are Dates. */
function storedEvent(
  overrides: Partial<EventWithRelations>,
  variables: Array<{ key: string; value: string }>,
): EventWithRelations {
  return {
    id: EVENT_ID,
    userId: OWNER,
    description: null,
    shared: false,
    content: null,
    httpMethod: null,
    httpUrl: null,
    httpHeaders: null,
    httpBody: null,
    toolActionConfig: null,
    status: EventStatus.DRAFT,
    triggerType: EventTriggerType.MANUAL,
    scheduleNumber: 1,
    scheduleUnit: TimeUnit.MINUTES,
    customSchedule: null,
    timezone: "UTC",
    catchupPolicy: CatchupPolicy.SKIP,
    overlapPolicy: OverlapPolicy.ALLOW,
    priority: 1,
    runLocation: RunLocation.LOCAL,
    serverId: null,
    timeoutValue: 30,
    timeoutUnit: TimeUnit.SECONDS,
    retries: 0,
    startTime: null,
    maxExecutions: 0,
    resetCounterOnActive: false,
    tags: [],
    lastRunAt: null,
    nextRunAt: null,
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    updatedAt: new Date("2026-01-02T03:04:05.000Z"),
    servers: [],
    ...overrides,
    envVars: variables.map(
      ({ key, value }, index) =>
        ({
          id: index + 1,
          eventId: EVENT_ID,
          key,
          value: `ciphertext:${value}`,
          createdAt: new Date("2026-01-02T03:04:05.000Z"),
          updatedAt: new Date("2026-01-02T03:04:05.000Z"),
        }) as EnvVar,
    ),
  } as EventWithRelations;
}

const EVENTS = [
  {
    event: "a scheduled script on a server and locally",
    stored: storedEvent(
      {
        name: "nightly",
        description: "A described event",
        type: EventType.BASH,
        content: 'echo "$FOO"',
        status: EventStatus.ACTIVE,
        triggerType: EventTriggerType.SCHEDULE,
        scheduleNumber: 7,
        scheduleUnit: TimeUnit.HOURS,
        timezone: "Europe/Berlin",
        catchupPolicy: CatchupPolicy.RUN_ONCE,
        overlapPolicy: OverlapPolicy.SKIP,
        priority: 3,
        runLocation: RunLocation.LOCAL_AND_REMOTE,
        timeoutValue: 5,
        timeoutUnit: TimeUnit.MINUTES,
        retries: 2,
        maxExecutions: 9,
        resetCounterOnActive: true,
        tags: ["alpha", "beta"],
        startTime: new Date("2027-03-04T05:06:00.000Z"),
        servers: [sandbox],
      },
      [
        { key: "FOO", value: "bar" },
        { key: "WITH_SPACES", value: "two words" },
      ],
    ),
    expected: {
      id: EVENT_ID,
      name: "nightly",
      description: "A described event",
      shared: false,
      type: EventType.BASH,
      content: 'echo "$FOO"',
      status: EventStatus.ACTIVE,
      triggerType: EventTriggerType.SCHEDULE,
      scheduleNumber: 7,
      scheduleUnit: TimeUnit.HOURS,
      timezone: "Europe/Berlin",
      catchupPolicy: CatchupPolicy.RUN_ONCE,
      overlapPolicy: OverlapPolicy.SKIP,
      priority: 3,
      runLocation: RunLocation.LOCAL_AND_REMOTE,
      selectedServerIds: [6],
      timeoutValue: 5,
      timeoutUnit: TimeUnit.MINUTES,
      retries: 2,
      maxExecutions: 9,
      resetCounterOnActive: true,
      envVars: [
        { key: "FOO", value: "bar" },
        { key: "WITH_SPACES", value: "two words" },
      ],
      tags: ["alpha", "beta"],
      startTime: "2027-03-04T05:06:00.000Z",
    },
  },
  {
    event: "a cron script on a server only",
    stored: storedEvent(
      {
        name: "weekly",
        type: EventType.PYTHON,
        content: "print('hi')",
        status: EventStatus.PAUSED,
        triggerType: EventTriggerType.SCHEDULE,
        customSchedule: "0 3 * * 1",
        timezone: "America/New_York",
        runLocation: RunLocation.REMOTE,
        // With seconds, and in the hour the clocks repeat in this browser's zone.
        startTime: new Date("2027-11-07T09:30:30.500Z"),
        servers: [sandbox],
      },
      [{ key: "A", value: "1" }],
    ),
    expected: {
      name: "weekly",
      type: EventType.PYTHON,
      status: EventStatus.PAUSED,
      customSchedule: "0 3 * * 1",
      timezone: "America/New_York",
      runLocation: RunLocation.REMOTE,
      selectedServerIds: [6],
      envVars: [{ key: "A", value: "1" }],
      startTime: "2027-11-07T09:30:30.500Z",
    },
  },
  {
    event: "an HTTP request",
    stored: storedEvent(
      {
        name: "webhook",
        type: EventType.HTTP_REQUEST,
        httpMethod: "POST",
        httpUrl: "https://example.test/hook",
        httpHeaders: [{ key: "X-Key", value: "v" }],
        httpBody: '{"a":1}',
        tags: ["http"],
      },
      [{ key: "H", value: "1" }],
    ),
    expected: {
      name: "webhook",
      type: EventType.HTTP_REQUEST,
      httpMethod: "POST",
      httpUrl: "https://example.test/hook",
      httpHeaders: [{ key: "X-Key", value: "v" }],
      httpBody: '{"a":1}',
      envVars: [{ key: "H", value: "1" }],
      tags: ["http"],
    },
  },
  {
    event: "a tool action",
    stored: storedEvent(
      {
        name: "notify",
        type: EventType.TOOL_ACTION,
        toolActionConfig: {
          toolType: "SLACK",
          toolId: 1,
          actionId: "slack-send-message",
          parameters: { channel: "#ops", message: "hi" },
        },
      },
      [{ key: "T", value: "1" }],
    ),
    expected: {
      name: "notify",
      type: EventType.TOOL_ACTION,
      toolActionConfig: expect.stringContaining("slack-send-message") as string,
      envVars: [{ key: "T", value: "1" }],
    },
  },
  {
    // Rows from before the enum migration hold lowercase values, and the form's
    // schema refuses those with nothing on screen, so the save would do nothing.
    event: "an older row with lowercase units and location",
    stored: storedEvent(
      {
        name: "legacy",
        type: EventType.BASH,
        content: "true",
        triggerType: EventTriggerType.SCHEDULE,
        scheduleNumber: 2,
        scheduleUnit: "hours" as TimeUnit,
        timeoutUnit: "minutes" as TimeUnit,
        runLocation: "remote" as RunLocation,
        servers: [sandbox],
      },
      [{ key: "OLD", value: "1" }],
    ),
    expected: {
      name: "legacy",
      scheduleNumber: 2,
      scheduleUnit: TimeUnit.HOURS,
      timeoutUnit: TimeUnit.MINUTES,
      runLocation: RunLocation.REMOTE,
      selectedServerIds: [6],
      envVars: [{ key: "OLD", value: "1" }],
    },
  },
  {
    event: "an event with no variables",
    stored: storedEvent(
      {
        name: "plain",
        type: EventType.BASH,
        content: "true",
      },
      [],
    ),
    expected: { name: "plain", envVars: [] },
  },
];

const SURFACES: Array<[string, () => React.ReactElement]> = [
  ["the /edit page", () => <EditEventPage />],
  [
    "the workflow canvas's edit modal",
    () => <EventEditModal isOpen onClose={jest.fn()} eventId={EVENT_ID} />,
  ],
  [
    "the event page's Edit tab",
    () => {
      window.location.hash = "#edit";
      return <EventDetails eventId={String(EVENT_ID)} />;
    },
  ],
];

/** Open the event on one surface, save without touching anything, and return what was sent. */
async function saveUntouched(
  stored: EventWithRelations,
  surface: () => React.ReactElement,
): Promise<Record<string, unknown>> {
  mockUpdateMutateAsync.mockClear();
  mockApiEvent = toEventApiDto(stored, OWNER, { revealEnvVarValues: true });

  const user = userEvent.setup();
  render(surface());
  await user.click(await screen.findByText("Update Event"));
  await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1), {
    timeout: 10_000,
  });
  const payload = mockUpdateMutateAsync.mock.calls[0]?.[0] as Record<
    string,
    unknown
  >;

  cleanup();
  return payload;
}

describe("saving an event without changing anything", () => {
  beforeEach(() => {
    mockUpdateMutateAsync.mockReset().mockResolvedValue({ id: EVENT_ID });
    mockRefetch.mockReset().mockResolvedValue({ data: undefined });
  });

  afterEach(() => {
    window.location.hash = "";
  });

  describe.each(EVENTS)("$event", ({ stored, expected }) => {
    it.each(SURFACES)("keeps what it has, from %s", async (_name, surface) => {
      const payload = await saveUntouched(stored, surface);
      expect(payload).toEqual(expect.objectContaining(expected));
    });

    it("sends the same thing from all of them", async () => {
      const sent: Array<Record<string, unknown>> = [];
      for (const [, surface] of SURFACES) {
        sent.push(await saveUntouched(stored, surface));
      }
      expect(sent[1]).toEqual(sent[0]);
      expect(sent[2]).toEqual(sent[0]);
    });
  });

  it.each(SURFACES)("shows the variables, on %s", async (_name, surface) => {
    mockApiEvent = toEventApiDto(EVENTS[0]!.stored, OWNER, {
      revealEnvVarValues: true,
    });
    render(surface());

    expect(await screen.findByDisplayValue("FOO")).toBeInTheDocument();
    expect(screen.getByDisplayValue("bar")).toBeInTheDocument();
    expect(screen.getByDisplayValue("WITH_SPACES")).toBeInTheDocument();
    expect(screen.getByDisplayValue("two words")).toBeInTheDocument();
  });

  it.each(SURFACES)(
    "shows the start time in the browser's timezone and names it, on %s",
    async (_name, surface) => {
      mockApiEvent = toEventApiDto(EVENTS[0]!.stored, OWNER, {
        revealEnvVarValues: true,
      });
      render(surface());

      expect(await screen.findByLabelText("Start Time (Optional)")).toHaveValue(
        "2027-03-03T21:06",
      );
      expect(
        screen.getByText(/your browser's timezone \(America\/Los_Angeles\)/),
      ).toBeInTheDocument();
    },
  );

  it.each(SURFACES)(
    "reads a new start time as the browser's, on %s",
    async (_name, surface) => {
      mockApiEvent = toEventApiDto(EVENTS[0]!.stored, OWNER, {
        revealEnvVarValues: true,
      });
      const user = userEvent.setup();
      render(surface());

      fireEvent.change(await screen.findByLabelText("Start Time (Optional)"), {
        target: { value: "2027-03-03T22:00" },
      });
      await user.click(screen.getByText("Update Event"));

      await waitFor(() =>
        expect(mockUpdateMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ startTime: "2027-03-04T06:00:00.000Z" }),
        ),
      );
    },
  );
});
