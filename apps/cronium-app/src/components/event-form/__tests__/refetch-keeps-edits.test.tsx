/**
 * What someone has typed into the event form has to survive what goes on around it.
 * Coming back to a window refetches the event, the Edit tab re-renders for reasons of
 * its own, and the form's own type select used to bring stored values back. Values are
 * masked, so a variable put back to its stored value goes unnoticed, and the next save
 * writes the old value.
 *
 * What nobody has edited goes the other way. A save sends the whole form, so a field
 * still showing an old value would write it over a newer one. It takes the new value.
 *
 * React Query is real here, down to its focus handling, because this came from how it
 * behaves: `Date` fields defeat its structural sharing, so every refetch hands the form
 * a new object even when nothing changed. Only the request is a stub. Each place that
 * edits an event runs against the same `events.getById` result, built by the real
 * `toEventApiDto`, as in `untouched-save.test.tsx`.
 */
import React, { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockFetchEvent = jest.fn();
const mockUpdateMutateAsync = jest.fn();
const mockMutation = { mutate: jest.fn(), mutateAsync: jest.fn() };
const mockLogs = { logs: [] };
const mockLogUpdateListeners = new Set<(update: { logId: number }) => void>();
const mockSocket = {
  subscribeToLog: jest.fn(),
  unsubscribeFromLog: jest.fn(),
  subscribeToLogUpdates: (listener: (update: { logId: number }) => void) => {
    mockLogUpdateListeners.add(listener);
    return () => mockLogUpdateListeners.delete(listener);
  },
};

jest.mock("@/lib/trpc", () => {
  const { useQuery } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  return {
    trpc: {
      events: {
        getById: {
          useQuery: (input: { id: number }, options?: object) =>
            useQuery({
              queryKey: ["events.getById", input],
              queryFn: () => mockFetchEvent() as Promise<unknown>,
              ...options,
            }),
        },
        getLogs: {
          useQuery: () => ({
            data: mockLogs,
            isLoading: false,
            refetch: jest.fn(),
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
              servers: [
                { id: 6, name: "sandbox", address: "192.0.2.10" },
                { id: 7, name: "second", address: "192.0.2.11" },
              ],
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
  };
});

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
    MonacoEditor: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange?: (value: string) => void;
    }) =>
      ReactActual.createElement("textarea", {
        "aria-label": "Script",
        value: value ?? "",
        onChange: (event: { target: { value: string } }) =>
          onChange?.(event.target.value),
      }),
  };
});

jest.mock("@/components/dashboard/AIScriptAssistant-lazy", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: ({ onApplyCode }: { onApplyCode: (code: string) => void }) =>
      ReactActual.createElement(
        "button",
        { type: "button", onClick: () => onApplyCode("echo from assistant") },
        "Apply from assistant",
      ),
  };
});

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

import { toast } from "@cronium/ui";
import EditEventPage from "@/app/dashboard/(main)/events/[id]/edit/page";
import { EventDetails } from "@/components/event-details/EventDetails";
import { EventEditModal } from "@/components/ui/event-edit-modal";
import { getDefaultScriptContent } from "@/lib/scriptTemplates";
import { toEventApiDto } from "@/server/security/api-dto";
import "@/tools/plugins";
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

// Each test renders the whole form, and CI runs with coverage.
jest.setTimeout(30_000);

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
    name: "nightly",
    description: "A described event",
    shared: false,
    type: EventType.BASH,
    content: 'echo "$FOO"',
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
    runLocation: RunLocation.LOCAL_AND_REMOTE,
    serverId: null,
    timeoutValue: 30,
    timeoutUnit: TimeUnit.SECONDS,
    retries: 0,
    startTime: null,
    maxExecutions: 0,
    resetCounterOnActive: false,
    tags: ["alpha"],
    lastRunAt: null,
    nextRunAt: null,
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    updatedAt: new Date("2026-01-02T03:04:05.000Z"),
    servers: [sandbox],
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

const scriptEvent = () => storedEvent({}, [{ key: "FOO", value: "stored" }]);

const httpEvent = () =>
  storedEvent(
    {
      type: EventType.HTTP_REQUEST,
      content: null,
      httpMethod: "POST",
      httpUrl: "https://example.test/stored",
      httpHeaders: [{ key: "X-Key", value: "stored" }],
      httpBody: '{"a":1}',
    },
    [{ key: "FOO", value: "stored" }],
  );

const toolEvent = () =>
  storedEvent(
    {
      type: EventType.TOOL_ACTION,
      content: null,
      runLocation: RunLocation.LOCAL,
      servers: [],
      toolActionConfig: {
        toolType: "SLACK",
        toolId: 1,
        actionId: "slack-send-message",
        parameters: { channel: "#stored" },
      },
    },
    [],
  );

/**
 * Answer every fetch with a row of its own. Sharing one would share its Dates, and
 * React Query would then hand back the same object, which the wire never allows.
 */
function serve(row: () => EventWithRelations) {
  mockFetchEvent.mockImplementation(() =>
    Promise.resolve(toEventApiDto(row(), OWNER, { revealEnvVarValues: true })),
  );
}

const SANDBOX_SERVER = "sandbox (192.0.2.10)";
const SECOND_SERVER = "second (192.0.2.11)";

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

async function open(surface: () => React.ReactElement) {
  // Retries off: a refetch that fails should fail now, not after React Query's backoff.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>{surface()}</QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Update Event" });
  return userEvent.setup();
}

/** Longer than React Query's timer, which is how it tells the page about an answer. */
const nextTimers = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * Come back to the window once the query has gone stale, and wait until the page has
 * what the fetch answered. The Edit tab's `staleTime` is 30 seconds and the modal's a
 * minute. Returns how many fetches that started.
 */
async function refocus() {
  const fetchesBefore = mockFetchEvent.mock.calls.length;
  const now = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(now + 5 * 60 * 1000);
  await act(async () => {
    window.dispatchEvent(new Event("visibilitychange"));
    await nextTimers();
    await Promise.allSettled(mockFetchEvent.mock.results.map((r) => r.value));
    await nextTimers();
  });
  return mockFetchEvent.mock.calls.length - fetchesBefore;
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Update Event" }));
  await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1));
  return mockUpdateMutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
}

const changeValue = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  mockFetchEvent.mockReset();
  mockUpdateMutateAsync.mockReset().mockResolvedValue({ id: EVENT_ID });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.location.hash = "";
});

// Without this the tests below could pass with nothing refetched.
it.each(SURFACES)(
  "coming back to the window refetches %s",
  async (_name, surface) => {
    serve(scriptEvent);
    await open(surface);

    expect(await refocus()).toBe(1);
  },
);

describe.each(SURFACES)("a refetch on %s", (_name, surface) => {
  it("keeps a changed variable, and the next save sends it", async () => {
    serve(scriptEvent);
    const user = await open(surface);

    changeValue("Value", "typed");
    await refocus();

    expect(screen.getByLabelText("Value")).toHaveValue("typed");
    expect(await save(user)).toEqual(
      expect.objectContaining({ envVars: [{ key: "FOO", value: "typed" }] }),
    );
  });

  it("keeps a variable added or removed", async () => {
    serve(scriptEvent);
    const user = await open(surface);

    await user.click(screen.getByRole("button", { name: "Add Variable" }));
    fireEvent.change(document.getElementById("envKey-1")!, {
      target: { value: "ADDED" },
    });
    await refocus();

    expect(document.getElementById("envKey-1")).toHaveValue("ADDED");

    await user.click(screen.getAllByRole("button", { name: "×" })[0]!);
    await refocus();

    expect(document.getElementById("envKey-0")).toHaveValue("ADDED");
    expect(document.getElementById("envKey-1")).toBeNull();
  });

  it("keeps a changed tag", async () => {
    serve(scriptEvent);
    const user = await open(surface);

    await user.type(
      screen.getByPlaceholderText("Add tags to organize your events..."),
      "typed{Enter}",
    );
    await refocus();

    expect(await save(user)).toEqual(
      expect.objectContaining({ tags: ["alpha", "typed"] }),
    );
  });

  it("keeps a changed server selection", async () => {
    serve(scriptEvent);
    const user = await open(surface);

    await user.click(screen.getByRole("checkbox", { name: SECOND_SERVER }));
    await user.click(screen.getByRole("checkbox", { name: SANDBOX_SERVER }));
    await refocus();

    expect(await save(user)).toEqual(
      expect.objectContaining({ selectedServerIds: [7] }),
    );
  });

  it("keeps changed HTTP fields", async () => {
    serve(httpEvent);
    const user = await open(surface);

    changeValue("Request URL", "https://example.test/typed");
    fireEvent.change(screen.getByPlaceholderText("Header Value"), {
      target: { value: "typed" },
    });
    await refocus();

    expect(screen.getByLabelText("Request URL")).toHaveValue(
      "https://example.test/typed",
    );
    expect(await save(user)).toEqual(
      expect.objectContaining({
        httpUrl: "https://example.test/typed",
        httpHeaders: [{ key: "X-Key", value: "typed" }],
      }),
    );
  });

  it("keeps changed tool action settings", async () => {
    serve(toolEvent);
    const user = await open(surface);

    const channel = await waitFor(() => {
      const field = document.getElementById("channel");
      expect(field).toHaveValue("#stored");
      return field!;
    });
    fireEvent.change(channel, { target: { value: "#typed" } });
    await refocus();

    expect(document.getElementById("channel")).toHaveValue("#typed");
    const { toolActionConfig } = await save(user);
    expect(JSON.parse(toolActionConfig as string)).toEqual(
      expect.objectContaining({ parameters: { channel: "#typed" } }),
    );
  });

  it("keeps the fields that never went back, too", async () => {
    serve(scriptEvent);
    await open(surface);

    changeValue("Event Name", "typed name");
    changeValue("Script", "echo typed");
    await refocus();

    expect(screen.getByLabelText("Event Name")).toHaveValue("typed name");
    expect(screen.getByLabelText("Script")).toHaveValue("echo typed");
  });

  it("keeps what was typed when the refetch brings something else for that field", async () => {
    serve(scriptEvent);
    const user = await open(surface);

    changeValue("Value", "typed");
    serve(() => storedEvent({}, [{ key: "FOO", value: "changed elsewhere" }]));
    await refocus();

    expect(screen.getByLabelText("Value")).toHaveValue("typed");
    expect(await save(user)).toEqual(
      expect.objectContaining({ envVars: [{ key: "FOO", value: "typed" }] }),
    );
  });

  it("picks up what changed in the fields nobody has edited", async () => {
    serve(scriptEvent);
    const user = await open(surface);

    changeValue("Value", "typed");
    serve(() =>
      storedEvent(
        {
          name: "renamed elsewhere",
          description: "described elsewhere",
          content: "echo elsewhere",
          tags: ["elsewhere"],
          status: EventStatus.PAUSED,
          retries: 3,
          servers: [],
        },
        [{ key: "FOO", value: "changed elsewhere" }],
      ),
    );
    await refocus();

    expect(screen.getByLabelText("Event Name")).toHaveValue(
      "renamed elsewhere",
    );
    expect(screen.getByLabelText("Description")).toHaveValue(
      "described elsewhere",
    );
    expect(screen.getByLabelText("Script")).toHaveValue("echo elsewhere");
    expect(screen.getByLabelText("Retries on Failure")).toHaveValue(3);
    expect(screen.getByLabelText("Value")).toHaveValue("typed");
    expect(await save(user)).toEqual(
      expect.objectContaining({
        name: "renamed elsewhere",
        description: "described elsewhere",
        content: "echo elsewhere",
        tags: ["elsewhere"],
        status: EventStatus.PAUSED,
        retries: 3,
        selectedServerIds: [],
        envVars: [{ key: "FOO", value: "typed" }],
      }),
    );
  });

  it("picks up a changed variable nobody has edited, and doesn't write the old one back", async () => {
    serve(scriptEvent);
    const user = await open(surface);

    changeValue("Event Name", "typed name");
    serve(() => storedEvent({}, [{ key: "FOO", value: "changed elsewhere" }]));
    await refocus();

    expect(await save(user)).toEqual(
      expect.objectContaining({
        name: "typed name",
        envVars: [{ key: "FOO", value: "changed elsewhere" }],
      }),
    );
  });

  it("treats a field changed back to what's stored as not edited", async () => {
    serve(scriptEvent);
    await open(surface);

    changeValue("Event Name", "typed name");
    changeValue("Event Name", "nightly");
    serve(() => storedEvent({ name: "renamed elsewhere" }, []));
    await refocus();

    expect(screen.getByLabelText("Event Name")).toHaveValue(
      "renamed elsewhere",
    );
  });

  it("stays on screen, with what was typed, when the refetch fails", async () => {
    serve(scriptEvent);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await open(surface);

    changeValue("Value", "typed");
    mockFetchEvent.mockImplementation(() =>
      Promise.reject(new Error("The server went away")),
    );
    await refocus();

    expect(screen.getByLabelText("Value")).toHaveValue("typed");

    serve(scriptEvent);
    await refocus();

    expect(screen.getByLabelText("Value")).toHaveValue("typed");
  });
});

describe("what else re-renders the Edit tab", () => {
  const [, editTab] = SURFACES[2]!;

  it("keeps a changed variable through a log update over the socket", async () => {
    serve(scriptEvent);
    await open(editTab);

    changeValue("Value", "typed");
    act(() => {
      mockLogUpdateListeners.forEach((listener) => listener({ logId: 1 }));
    });

    expect(screen.getByLabelText("Value")).toHaveValue("typed");
  });

  it("keeps a changed variable through a toast", async () => {
    serve(scriptEvent);
    await open(editTab);

    changeValue("Value", "typed");
    act(() => {
      toast({ title: "Something else" });
    });

    expect(screen.getByLabelText("Value")).toHaveValue("typed");
  });
});

describe("changing the event's type", () => {
  const [, page] = SURFACES[0]!;

  // Radix Select asks the browser for these, and jsdom doesn't have them.
  beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.scrollIntoView = () => undefined;
  });

  async function chooseType(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
  ) {
    await user.click(screen.getByRole("combobox", { name: "Event Type" }));
    await user.click(await screen.findByRole("option", { name }));
  }

  it("keeps variables, tags and servers on the way to HTTP and back", async () => {
    serve(scriptEvent);
    const user = await open(page);

    changeValue("Value", "typed");
    await user.type(
      screen.getByPlaceholderText("Add tags to organize your events..."),
      "typed{Enter}",
    );
    await user.click(screen.getByRole("checkbox", { name: SECOND_SERVER }));

    await chooseType(user, "HTTP Request");
    expect(screen.getByLabelText("Value")).toHaveValue("typed");

    await chooseType(user, "Bash");
    expect(await save(user)).toEqual(
      expect.objectContaining({
        envVars: [{ key: "FOO", value: "typed" }],
        tags: ["alpha", "typed"],
        selectedServerIds: [6, 7],
      }),
    );
  });

  it("keeps HTTP edits on the way to another type and back", async () => {
    serve(httpEvent);
    const user = await open(page);

    changeValue("Request URL", "https://example.test/typed");
    await chooseType(user, "Bash");
    await chooseType(user, "HTTP Request");

    expect(screen.getByLabelText("Request URL")).toHaveValue(
      "https://example.test/typed",
    );
  });

  describe("on an event that used to be an HTTP request", () => {
    const formerHttpEvent = () =>
      storedEvent(
        {
          type: EventType.BASH,
          content: "echo hi",
          httpMethod: "POST",
          httpUrl: "https://example.test/stored",
          httpHeaders: [{ key: "X-Key", value: "stored" }],
          httpBody: '{"a":1}',
        },
        [],
      );

    it("offers its settings again when it's switched back", async () => {
      serve(formerHttpEvent);
      const user = await open(page);

      await chooseType(user, "HTTP Request");

      expect(screen.getByLabelText("Request URL")).toHaveValue(
        "https://example.test/stored",
      );
      expect(screen.getByPlaceholderText("Header Name")).toHaveValue("X-Key");
      expect(await save(user)).toEqual(
        expect.objectContaining({
          httpMethod: "POST",
          httpUrl: "https://example.test/stored",
          httpHeaders: [{ key: "X-Key", value: "stored" }],
          httpBody: '{"a":1}',
        }),
      );
    });

    it("doesn't send them while it's something else", async () => {
      serve(formerHttpEvent);
      const user = await open(page);

      const payload = await save(user);

      expect(payload.httpMethod).toBeUndefined();
      expect(payload.httpUrl).toBeUndefined();
      expect(payload.httpHeaders).toBeUndefined();
      expect(payload.httpBody).toBeUndefined();
    });

    // The headers aren't on screen, so nothing would say why the save did nothing.
    it("can still save with stored headers the form's schema wouldn't take", async () => {
      serve(() => ({
        ...formerHttpEvent(),
        httpHeaders: { "X-Key": "an object, not a list" },
      }));
      const user = await open(page);

      expect(await save(user)).toEqual(
        expect.objectContaining({ content: "echo hi" }),
      );
    });
  });

  it("keeps a script written after changing the type through a refetch", async () => {
    serve(httpEvent);
    const user = await open(page);

    await chooseType(user, "Bash");
    changeValue("Script", "echo typed");
    await refocus();

    expect(screen.getByLabelText("Script")).toHaveValue("echo typed");
    expect(await save(user)).toEqual(
      expect.objectContaining({
        type: EventType.BASH,
        content: "echo typed",
      }),
    );
  });

  it("keeps it when the refetch brings a different stored script as well", async () => {
    serve(scriptEvent);
    const user = await open(page);

    await chooseType(user, "Python");
    changeValue("Script", "print('typed')");
    serve(() =>
      storedEvent({ content: "echo elsewhere" }, [
        { key: "FOO", value: "stored" },
      ]),
    );
    await refocus();

    expect(screen.getByLabelText("Script")).toHaveValue("print('typed')");
  });

  it("still swaps in the new type's template when the type changes", async () => {
    serve(scriptEvent);
    const user = await open(page);

    await chooseType(user, "Python");

    expect(screen.getByLabelText("Script")).toHaveValue(
      getDefaultScriptContent(EventType.PYTHON),
    );
  });

  it("keeps the new type's template when a refetch changes the stored script", async () => {
    serve(scriptEvent);
    const user = await open(page);

    await chooseType(user, "Python");
    serve(() =>
      storedEvent({ content: "echo elsewhere" }, [
        { key: "FOO", value: "stored" },
      ]),
    );
    await refocus();

    expect(screen.getByLabelText("Script")).toHaveValue(
      getDefaultScriptContent(EventType.PYTHON),
    );
  });

  it("stays local after a change to Tool Action when a refetch changes the stored servers", async () => {
    const leftoverToolEvent = (servers: Server[]) => () =>
      storedEvent(
        {
          servers,
          toolActionConfig: {
            toolType: "SLACK",
            toolId: 1,
            actionId: "slack-send-message",
            parameters: {},
          },
        },
        [],
      );
    serve(leftoverToolEvent([sandbox]));
    const user = await open(page);

    await chooseType(user, "Tool Action");
    serve(leftoverToolEvent([{ ...sandbox, id: 7, name: "second" }]));
    await refocus();

    expect(await save(user)).toEqual(
      expect.objectContaining({
        type: EventType.TOOL_ACTION,
        selectedServerIds: [],
      }),
    );
  });

  it("follows a type changed elsewhere, with that script rather than a template", async () => {
    serve(scriptEvent);
    await open(page);

    serve(() =>
      storedEvent({ type: EventType.PYTHON, content: "print('elsewhere')" }, [
        { key: "FOO", value: "stored" },
      ]),
    );
    await refocus();

    expect(
      screen.getByRole("combobox", { name: "Event Type" }),
    ).toHaveTextContent("Python");
    expect(screen.getByLabelText("Script")).toHaveValue("print('elsewhere')");
  });
});

describe("an event with no script yet", () => {
  const [, page] = SURFACES[0]!;
  const noScript = (overrides: Partial<EventWithRelations> = {}) =>
    storedEvent({ content: "", ...overrides }, [
      { key: "FOO", value: "stored" },
    ]);
  const template = getDefaultScriptContent(EventType.BASH);

  it("starts from the template, and keeps it when something else changes", async () => {
    serve(noScript);
    await open(page);
    expect(screen.getByLabelText("Script")).toHaveValue(template);

    serve(() => noScript({ name: "renamed elsewhere" }));
    await refocus();

    expect(screen.getByLabelText("Event Name")).toHaveValue(
      "renamed elsewhere",
    );
    expect(screen.getByLabelText("Script")).toHaveValue(template);
  });

  // The template isn't an edit, so it shouldn't win over a real script.
  it("takes a script written elsewhere over the template", async () => {
    serve(noScript);
    await open(page);

    serve(() => noScript({ content: "echo elsewhere" }));
    await refocus();

    expect(screen.getByLabelText("Script")).toHaveValue("echo elsewhere");
  });
});

describe("what edits a field from outside it", () => {
  const [, page] = SURFACES[0]!;
  const changedElsewhere = () =>
    storedEvent({ content: "echo elsewhere" }, [
      { key: "FOO", value: "stored" },
    ]);

  it("counts as an edit when it's the assistant's code", async () => {
    serve(scriptEvent);
    const user = await open(page);

    await user.click(
      screen.getByRole("button", { name: "Apply from assistant" }),
    );
    serve(changedElsewhere);
    await refocus();

    expect(screen.getByLabelText("Script")).toHaveValue("echo from assistant");
  });

  it("counts as an edit when it's the Clear button", async () => {
    serve(scriptEvent);
    const user = await open(page);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    serve(changedElsewhere);
    await refocus();

    expect(screen.getByLabelText("Script")).toHaveValue("");
  });
});

describe("a refetch that changes something while an error is on screen", () => {
  const [, page] = SURFACES[0]!;

  it("keeps the error, and clears it when the field is fixed", async () => {
    serve(scriptEvent);
    const user = await open(page);

    changeValue("Event Name", "");
    await user.click(screen.getByRole("button", { name: "Update Event" }));
    await screen.findByText("Event name is required");

    serve(() => storedEvent({ retries: 3 }, [{ key: "FOO", value: "stored" }]));
    await refocus();

    expect(screen.getByLabelText("Retries on Failure")).toHaveValue(3);
    expect(screen.getByText("Event name is required")).toBeInTheDocument();

    changeValue("Event Name", "fixed");
    await waitFor(() =>
      expect(
        screen.queryByText("Event name is required"),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("a value shown in the clear", () => {
  const [, page] = SURFACES[0]!;
  const twoVariables = (first: string, second: string) => () =>
    storedEvent({}, [
      { key: first, value: `${first}-secret` },
      { key: second, value: `${second}-secret` },
    ]);

  it("doesn't reveal another variable when a refetch changes the rows", async () => {
    serve(twoVariables("FOO", "BAR"));
    const user = await open(page);

    await user.click(screen.getAllByRole("button", { name: "Show value" })[0]!);
    expect(screen.getByDisplayValue("FOO-secret")).toHaveProperty(
      "tagName",
      "TEXTAREA",
    );

    serve(twoVariables("BAR", "FOO"));
    await refocus();

    expect(document.getElementById("envKey-0")).toHaveValue("BAR");
    expect(screen.getAllByRole("button", { name: "Show value" })).toHaveLength(
      2,
    );
  });

  it("stays shown when a refetch changes something else", async () => {
    serve(twoVariables("FOO", "BAR"));
    const user = await open(page);

    await user.click(screen.getAllByRole("button", { name: "Show value" })[0]!);
    serve(() => ({
      ...twoVariables("FOO", "BAR")(),
      name: "renamed elsewhere",
    }));
    await refocus();

    expect(screen.getByLabelText("Event Name")).toHaveValue(
      "renamed elsewhere",
    );
    expect(screen.getByDisplayValue("FOO-secret")).toHaveProperty(
      "tagName",
      "TEXTAREA",
    );
  });
});

describe("the /edit page's own load failing", () => {
  it("says so when there's no event to show", async () => {
    const [, page] = SURFACES[0]!;
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetchEvent.mockImplementation(() =>
      Promise.reject(new Error("The server went away")),
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {page()}
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(
        "Failed to load event details. Please try again later.",
      ),
    ).toBeInTheDocument();
  });
});
