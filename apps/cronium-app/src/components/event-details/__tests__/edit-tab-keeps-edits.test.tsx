/**
 * What's typed in the event page's Edit tab has to survive a visit to another tab.
 * Radix unmounts an inactive tab's content, so going to Logs and back used to give a
 * new form with every field back to its stored value, with nothing to say so. A
 * variable's value is masked, so the next save could write the old one unnoticed.
 *
 * The form now stays mounted, which brings its own ways to go wrong, and most of this
 * file is about those: a save has to show what was saved on the way back, a change
 * made from the header has to reach a form that didn't remount to see it, and a hidden
 * form mustn't save, fetch, render or be reachable.
 *
 * Only the network is fake. `TrpcProvider`'s real QueryClient and tRPC's real hooks run
 * against a row in memory, with answers from the real `toEventApiDto`, because what a
 * save or a status change does to the form goes through the cache. Monaco can't run in
 * jsdom, so what hiding does to the real editor isn't covered here.
 */
import React, { act } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { focusManager, useQueryClient } from "@tanstack/react-query";

interface Request {
  path: string;
  input: Record<string, unknown>;
}

let mockStored: Record<string, unknown>;
const mockRequests: Request[] = [];
const mockFailingPaths = new Set<string>();
/** What the server does to a saved row on top of what it was sent. */
let mockAfterSave: (() => void) | null = null;
let mockCurrentUser = { id: "owner" };
const mockFormRendered = jest.fn();
// One object, because the event page's effects depend on these functions' identity.
const mockSocket = {
  subscribeToLog: jest.fn(),
  unsubscribeFromLog: jest.fn(),
  subscribeToLogUpdates: () => () => undefined,
};

// Stands in for AES: storage hands the API ciphertext, and only the DTO decrypts.
jest.mock("@/lib/security/field-secret", () => ({
  decryptEnvVarValue: (stored: string) => stored.replace(/^ciphertext:/, ""),
}));

async function mockAnswer(request: Request): Promise<unknown> {
  mockRequests.push(request);
  if (mockFailingPaths.has(request.path)) {
    throw new Error(`${request.path} failed`);
  }
  return mockServerAnswer(request);
}

jest.mock("@/lib/trpc", () => {
  const actual = jest.requireActual<typeof import("@/lib/trpc")>("@/lib/trpc");
  const { observable } = jest.requireActual<
    typeof import("@trpc/server/observable")
  >("@trpc/server/observable");
  const { TRPCClientError } =
    jest.requireActual<typeof import("@trpc/client")>("@trpc/client");

  return {
    ...actual,
    trpcClient: actual.trpc.createClient({
      links: [
        () =>
          ({ op }) =>
            observable((observer) => {
              mockAnswer({
                path: op.path,
                input: op.input as Record<string, unknown>,
              }).then(
                (data) => {
                  observer.next({ result: { type: "data", data } });
                  observer.complete();
                },
                (cause: Error) => observer.error(TRPCClientError.from(cause)),
              );
            }),
      ],
    }),
  };
});

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "42" }),
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/dashboard/events/42",
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockCurrentUser }),
}));

jest.mock("@/hooks/use-logs-socket", () => ({
  useLogsSocket: () => mockSocket,
}));

// next/dynamic would load the real form a tick later, for no benefit here. The Profiler
// says each time the form renders, for the test that it stops while it's hidden.
jest.mock("@/components/event-form/EventForm-lazy", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  const EventForm = jest.requireActual<
    typeof import("@/components/event-form/EventForm")
  >("@/components/event-form/EventForm").default;
  return {
    __esModule: true,
    default: (props: React.ComponentProps<typeof EventForm>) =>
      ReactActual.createElement(
        ReactActual.Profiler,
        { id: "form", onRender: () => mockFormRendered() },
        ReactActual.createElement(EventForm, props),
      ),
  };
});

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

jest.mock("@/components/dashboard/AIScriptAssistant-lazy", () => ({
  __esModule: true,
  default: () => null,
}));

// The real menu adds nothing here. The rest of the header is real.
jest.mock("@/components/ui/clickable-status-badge", () => {
  const { EventStatus: Status } =
    jest.requireActual<typeof import("@/shared/schema")>("@/shared/schema");
  return {
    ClickableStatusBadge: ({
      currentStatus,
      onStatusChange,
    }: {
      currentStatus: string;
      onStatusChange: (status: string) => void;
    }) => (
      <>
        <span data-testid="badge">{currentStatus}</span>
        {[Status.ACTIVE, Status.PAUSED, Status.DRAFT].map((status) => (
          <button key={status} onClick={() => onStatusChange(status)}>
            {`Set ${status}`}
          </button>
        ))}
      </>
    ),
  };
});

// The other tabs aren't what's being tested, and need a lot of data.
jest.mock("@/components/event-details/EventOverviewTab", () => ({
  EventOverviewTab: ({
    event,
    onRefresh,
  }: {
    event: { updatedAt: string };
    onRefresh: () => Promise<void>;
  }) => (
    <>
      <p>Overview panel</p>
      <p data-testid="event-read">{event.updatedAt}</p>
      <button onClick={() => void onRefresh()}>Read the event again</button>
    </>
  ),
}));
jest.mock("@/components/event-details/EventLogsTab", () => ({
  EventLogsTab: () => <p>Logs panel</p>,
}));
jest.mock("@/components/event-details/EventDeleteDialog", () => ({
  EventDeleteDialog: () => null,
}));

import { EventDetails } from "@/components/event-details/EventDetails";
import { TrpcProvider } from "@/components/providers/TrpcProvider";
import { getDefaultScriptContent } from "@/lib/scriptTemplates";
import { toEventApiDto } from "@/server/security/api-dto";
import type { EventWithRelations } from "@/server/storage";
import "@/tools/plugins";
import {
  CatchupPolicy,
  EventStatus,
  EventTriggerType,
  EventType,
  OverlapPolicy,
  RunLocation,
  TimeUnit,
} from "@/shared/schema";

// Each test renders the whole form, sometimes twice, and CI runs with coverage.
jest.setTimeout(120_000);

const OWNER = "owner";
const EVENT_ID = 42;
const FIND = { timeout: 60_000 };
const SANDBOX = { id: 6, name: "sandbox", address: "192.0.2.10" };
const SECOND = { id: 7, name: "second", address: "192.0.2.11" };
const SANDBOX_SERVER = "sandbox (192.0.2.10)";
const SECOND_SERVER = "second (192.0.2.11)";

function scriptEvent(): Record<string, unknown> {
  return {
    id: EVENT_ID,
    userId: OWNER,
    name: "nightly",
    description: "Stored description",
    shared: false,
    type: EventType.BASH,
    content: 'echo "$FOO"',
    httpMethod: null,
    httpUrl: null,
    httpHeaders: null,
    httpBody: null,
    toolActionConfig: null,
    status: EventStatus.ACTIVE,
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
    executionCount: 0,
    tags: ["alpha"],
    lastRunAt: null,
    nextRunAt: null,
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    updatedAt: new Date("2026-01-02T03:04:05.000Z"),
    servers: [SANDBOX],
    envVars: storedVariables([{ key: "FOO", value: "stored" }]),
  };
}

const httpEvent = () => ({
  ...scriptEvent(),
  type: EventType.HTTP_REQUEST,
  content: null,
  httpMethod: "POST",
  httpUrl: "https://example.test/stored",
  httpHeaders: [{ key: "X-Key", value: "stored" }],
  httpBody: '{"a":1}',
});

const toolEvent = () => ({
  ...scriptEvent(),
  type: EventType.TOOL_ACTION,
  content: null,
  runLocation: RunLocation.LOCAL,
  servers: [],
  envVars: [],
  toolActionConfig: {
    toolType: "SLACK",
    toolId: 1,
    actionId: "slack-send-message",
    parameters: { channel: "#stored" },
  },
});

/** Variables as storage returns them: the values are ciphertext until the DTO. */
function storedVariables(variables: Array<{ key: string; value: string }>) {
  return variables.map(({ key, value }, index) => ({
    id: index + 1,
    eventId: EVENT_ID,
    key,
    value: `ciphertext:${value}`,
  }));
}

let eventAnswers = 0;

/**
 * With Dates of its own, as every answer over the wire has. Sharing them, React Query's
 * structural sharing would hand back the same object, and the page wouldn't re-render.
 * `updatedAt` differs each time too, so a test can see when an answer reaches the page.
 */
function eventDto() {
  const dto = toEventApiDto(
    mockStored as unknown as EventWithRelations,
    OWNER,
    {
      revealEnvVarValues: true,
    },
  );
  eventAnswers += 1;
  return {
    ...dto,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(new Date(dto.updatedAt).getTime() + eventAnswers),
  };
}

function mockServerAnswer({ path, input }: Request): unknown {
  switch (path) {
    case "events.getById":
      return eventDto();
    case "events.update": {
      const { id: _id, envVars, selectedServerIds, ...fields } = input;
      Object.assign(mockStored, fields, {
        ...(Array.isArray(envVars) && {
          envVars: storedVariables(
            envVars as Array<{ key: string; value: string }>,
          ),
        }),
        ...(Array.isArray(selectedServerIds) && {
          servers: [SANDBOX, SECOND].filter((server) =>
            (selectedServerIds as number[]).includes(server.id),
          ),
        }),
      });
      mockAfterSave?.();
      return eventDto();
    }
    case "events.activate":
      mockStored.status = EventStatus.ACTIVE;
      return { success: true };
    case "events.deactivate":
      mockStored.status = EventStatus.PAUSED;
      return { success: true };
    case "events.getLogs":
      return { logs: [] };
    case "events.validateCron":
      return { valid: true, next: [] };
    case "servers.getAll":
      return { servers: [SANDBOX, SECOND] };
    case "servers.getGroups":
      return { groups: [] };
    case "tools.getAll":
      return { tools: [{ id: 1, name: "slack", type: "SLACK" }] };
    case "toolActionTemplates.getByToolAction":
      return [];
    case "settings.getEditorSettings":
      return { data: null };
    default:
      throw new Error(`Nothing answers ${path} in this test`);
  }
}

function sent(path: string): Array<Record<string, unknown>> {
  return mockRequests
    .filter((request) => request.path === path)
    .map((request) => request.input);
}

/** The server's row changing with nothing in this tab knowing: another tab, the API. */
function changedElsewhere(fields: Record<string, unknown>) {
  Object.assign(mockStored, fields);
}

let clockOffset = 0;
let clock: jest.SpiedFunction<typeof Date.now>;
const realNow = Date.now.bind(Date);

/** A failure would otherwise spend 7 seconds on react-query's retries. */
function WithoutRetries() {
  useQueryClient().setDefaultOptions({ queries: { retry: false } });
  return null;
}

function openPage(hash: "#edit" | "" = "#edit") {
  window.location.hash = hash;
  render(
    <TrpcProvider>
      <WithoutRetries />
      <EventDetails eventId={String(EVENT_ID)} />
    </TrpcProvider>,
  );
  return userEvent.setup();
}

async function openEditTab() {
  const user = openPage();
  await saveButton();
  return user;
}

const saveButton = () =>
  screen.findByRole("button", { name: "Update Event" }, FIND);

type OtherTab = "Logs" | "Overview";

async function goTo(user: UserEvent, tab: OtherTab | "Edit") {
  await user.click(await screen.findByRole("tab", { name: tab }, FIND));
  if (tab === "Edit") {
    await saveButton();
  } else {
    await screen.findByText(`${tab} panel`, undefined, FIND);
  }
}

async function goAndComeBack(user: UserEvent, tab: OtherTab) {
  await goTo(user, tab);
  await goTo(user, "Edit");
}

/** Come back to the window once every query has gone stale. */
async function refocusLater() {
  clockOffset += 5 * 60 * 1000;
  act(() => {
    focusManager.setFocused(false);
  });
  act(() => {
    focusManager.setFocused(true);
  });
  // React Query starts its fetches a tick later.
  await settle();
}

/** Let what's in flight land. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

async function save(user: UserEvent) {
  const before = sent("events.update").length;
  await user.click(await saveButton());
  await waitFor(
    () => expect(sent("events.update").length).toBe(before + 1),
    FIND,
  );
  return sent("events.update")[before]!;
}

/** Read the event again from Overview, and wait for the answer to reach the page. */
async function readAgain(user: UserEvent) {
  const shown = screen.getByTestId("event-read").textContent;
  await user.click(
    screen.getByRole("button", { name: "Read the event again" }),
  );
  await waitFor(
    () => expect(screen.getByTestId("event-read").textContent).not.toBe(shown),
    FIND,
  );
}

const changeValue = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const selectedStatus = () => screen.getByRole("combobox", { name: "Status" });

const addTag = (user: UserEvent, tag: string) =>
  user.type(
    screen.getByPlaceholderText("Add tags to organize your events..."),
    `${tag}{Enter}`,
  );

const setBadge = async (user: UserEvent, status: EventStatus) => {
  await user.click(screen.getByRole("button", { name: `Set ${status}` }));
  await waitFor(
    () => expect(screen.getByTestId("badge")).toHaveTextContent(status),
    FIND,
  );
};

beforeAll(() => {
  // Radix Select asks the browser for these, and jsdom doesn't have them.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  mockStored = scriptEvent();
  eventAnswers = 0;
  mockRequests.length = 0;
  mockFailingPaths.clear();
  mockAfterSave = null;
  mockCurrentUser = { id: OWNER };
  clockOffset = 0;
  clock = jest
    .spyOn(Date, "now")
    .mockImplementation(() => realNow() + clockOffset);
});

afterEach(() => {
  clock.mockRestore();
  focusManager.setFocused(undefined);
  window.history.replaceState(null, "", "/");
  window.location.hash = "";
});

describe.each<[OtherTab]>([["Logs"], ["Overview"]])(
  "going to %s and back",
  (tab) => {
    it("keeps a changed variable and name, and the next save sends them", async () => {
      const user = await openEditTab();

      changeValue("Value", "typed");
      changeValue("Event Name", "typed name");
      await goAndComeBack(user, tab);

      expect(screen.getByLabelText("Value")).toHaveValue("typed");
      expect(screen.getByLabelText("Event Name")).toHaveValue("typed name");
      expect(await save(user)).toEqual(
        expect.objectContaining({
          name: "typed name",
          envVars: [{ key: "FOO", value: "typed" }],
        }),
      );
    });

    it("keeps every other kind of field", async () => {
      const user = await openEditTab();

      changeValue("Description", "typed description");
      changeValue("Script", "echo typed");
      await addTag(user, "typed");
      await user.click(screen.getByRole("checkbox", { name: SECOND_SERVER }));
      await user.click(screen.getByRole("button", { name: "Add Variable" }));
      fireEvent.change(document.getElementById("envKey-1")!, {
        target: { value: "ADDED" },
      });
      await goAndComeBack(user, tab);

      expect(screen.getByLabelText("Description")).toHaveValue(
        "typed description",
      );
      expect(screen.getByLabelText("Script")).toHaveValue("echo typed");
      expect(document.getElementById("envKey-1")).toHaveValue("ADDED");
      expect(
        screen.getByRole("checkbox", { name: SECOND_SERVER }),
      ).toBeChecked();
      expect(await save(user)).toEqual(
        expect.objectContaining({
          description: "typed description",
          content: "echo typed",
          tags: ["alpha", "typed"],
          selectedServerIds: [6, 7],
          envVars: [
            { key: "FOO", value: "stored" },
            { key: "ADDED", value: "" },
          ],
        }),
      );
    });

    it("keeps changed HTTP fields", async () => {
      mockStored = httpEvent();
      const user = await openEditTab();

      changeValue("Request URL", "https://example.test/typed");
      fireEvent.change(screen.getByPlaceholderText("Header Value"), {
        target: { value: "typed" },
      });
      await goAndComeBack(user, tab);

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
      mockStored = toolEvent();
      const user = await openEditTab();

      const channel = await waitFor(() => {
        const field = document.getElementById("channel");
        expect(field).toHaveValue("#stored");
        return field!;
      }, FIND);
      fireEvent.change(channel, { target: { value: "#typed" } });
      await goAndComeBack(user, tab);

      expect(document.getElementById("channel")).toHaveValue("#typed");
      const { toolActionConfig } = await save(user);
      expect(JSON.parse(toolActionConfig as string)).toEqual(
        expect.objectContaining({ parameters: { channel: "#typed" } }),
      );
    });

    it("keeps a changed type and the script that came with it", async () => {
      const user = await openEditTab();

      await user.click(screen.getByRole("combobox", { name: "Event Type" }));
      await user.click(await screen.findByRole("option", { name: "Python" }));
      await goAndComeBack(user, tab);

      expect(
        screen.getByRole("combobox", { name: "Event Type" }),
      ).toHaveTextContent("Python");
      expect(screen.getByLabelText("Script")).toHaveValue(
        getDefaultScriptContent(EventType.PYTHON),
      );
    });

    it("keeps what a save the server refused was trying to send", async () => {
      const user = await openEditTab();

      changeValue("Value", "typed");
      mockFailingPaths.add("events.update");
      await save(user);
      await saveButton(); // Reads "Updating..." until the refusal is in.
      await goAndComeBack(user, tab);

      expect(screen.getByLabelText("Value")).toHaveValue("typed");
    });
  },
);

it("keeps edits through several trips, by either tab", async () => {
  const user = await openEditTab();

  changeValue("Value", "first");
  await goAndComeBack(user, "Logs");
  changeValue("Event Name", "second");
  await goTo(user, "Overview");
  await goTo(user, "Logs");
  await goTo(user, "Edit");

  expect(screen.getByLabelText("Value")).toHaveValue("first");
  expect(screen.getByLabelText("Event Name")).toHaveValue("second");
});

describe("a form on another tab", () => {
  it("can't be seen or reached", async () => {
    const user = await openEditTab();

    await goTo(user, "Logs");

    expect(screen.queryByRole("button", { name: "Update Event" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Event Name" })).toBeNull();
    const field = document.getElementById("name");
    if (field) expect(field).not.toBeVisible();
    expect(
      within(screen.getByRole("tabpanel")).getByText("Logs panel"),
    ).toBeVisible();
  });

  it("doesn't take Ctrl+S, which goes to the browser as it does on any other tab", async () => {
    const user = await openEditTab();

    changeValue("Event Name", "typed name");
    await goTo(user, "Logs");
    const notCancelled = fireEvent.keyDown(document.body, {
      key: "s",
      ctrlKey: true,
    });
    await settle();

    expect(sent("events.update")).toEqual([]);
    expect(notCancelled).toBe(true);
    expect(mockStored.name).toBe("nightly");
    expect(screen.getByText("Logs panel")).toBeVisible();
  });

  it("takes Ctrl+S again once it's back", async () => {
    const user = await openEditTab();

    changeValue("Event Name", "typed name");
    await goAndComeBack(user, "Logs");
    const notCancelled = fireEvent.keyDown(document.body, {
      key: "s",
      ctrlKey: true,
    });

    await waitFor(() => expect(sent("events.update").length).toBe(1), FIND);
    expect(notCancelled).toBe(false);
    expect(sent("events.update")[0]).toEqual(
      expect.objectContaining({ name: "typed name" }),
    );
  });

  it("fetches nothing when the window comes back, and catches up on coming back itself", async () => {
    const user = await openEditTab();
    await waitFor(() => expect(sent("tools.getAll").length).toBe(1), FIND);
    const formQueries = ["servers.getAll", "servers.getGroups", "tools.getAll"];
    const counts = () => formQueries.map((path) => sent(path).length);
    const before = counts();

    await goTo(user, "Logs");
    const pageReadsBefore = sent("events.getById").length;
    await refocusLater();

    // The page's own read still happens, so this isn't passing for lack of a refocus.
    await waitFor(
      () =>
        expect(sent("events.getById").length).toBeGreaterThan(pageReadsBefore),
      FIND,
    );
    expect(counts()).toEqual(before);

    await goTo(user, "Edit");

    await waitFor(
      () => expect(counts()).toEqual(before.map((count) => count + 1)),
      FIND,
    );
  });

  // A read of the event re-renders the page, as each poll of a running job's log does,
  // and every copy of the event holds new Dates. Toasts are another matter: the form
  // subscribes to those itself.
  it("doesn't render along with the page, as it does on screen", async () => {
    const user = await openEditTab();
    await settle();

    mockFormRendered.mockClear();
    await refocusLater();
    await waitFor(() => expect(mockFormRendered).toHaveBeenCalled(), FIND);

    await goTo(user, "Logs");
    await settle();
    mockFormRendered.mockClear();
    changedElsewhere({ status: EventStatus.PAUSED });
    await refocusLater();
    await waitFor(
      () =>
        expect(screen.getByTestId("badge")).toHaveTextContent(
          EventStatus.PAUSED,
        ),
      FIND,
    );

    expect(mockFormRendered).not.toHaveBeenCalled();
  });

  it("doesn't check a cron expression again when the window comes back", async () => {
    mockStored = {
      ...scriptEvent(),
      triggerType: EventTriggerType.SCHEDULE,
      customSchedule: "0 0 * * *",
    };
    const user = await openEditTab();
    await waitFor(
      () => expect(sent("events.validateCron").length).toBeGreaterThan(0),
      FIND,
    );
    await goTo(user, "Logs");
    const before = sent("events.validateCron").length;

    await refocusLater();
    await settle();

    expect(sent("events.validateCron").length).toBe(before);
  });

  it("fetches a tool action's templates no more than the rest", async () => {
    mockStored = toolEvent();
    const user = await openEditTab();
    await waitFor(
      () =>
        expect(
          sent("toolActionTemplates.getByToolAction").length,
        ).toBeGreaterThan(0),
      FIND,
    );
    await goTo(user, "Logs");
    const before = sent("toolActionTemplates.getByToolAction").length;

    await refocusLater();

    expect(sent("toolActionTemplates.getByToolAction").length).toBe(before);
  });
});

describe("before the Edit tab has been opened", () => {
  it("loads no form and asks for none of its data", async () => {
    openPage("");

    await screen.findByText("Overview panel", undefined, FIND);

    expect(document.getElementById("name")).toBeNull();
    expect(sent("servers.getAll")).toEqual([]);
    expect(sent("tools.getAll")).toEqual([]);
  });

  it("opens with the event as it is by then", async () => {
    const user = openPage("");
    await screen.findByText("Overview panel", undefined, FIND);

    changedElsewhere({ description: "Changed before opening" });
    await readAgain(user);
    await goTo(user, "Edit");

    expect(screen.getByLabelText("Description")).toHaveValue(
      "Changed before opening",
    );
  });

  it("shows someone else's event's Edit tab as locked, not a form", async () => {
    mockCurrentUser = { id: "someone else" };
    openPage();

    expect(
      await screen.findByText(
        "You can't edit this shared event",
        undefined,
        FIND,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Edit" })).toBeNull();
    expect(document.getElementById("name")).toBeNull();
  });
});

describe("after a save", () => {
  it("shows what was saved on the way back, not what was typed", async () => {
    const user = await openEditTab();
    mockAfterSave = () => {
      // Anything a form holding on to what was typed would get wrong.
      mockStored.description = "As the server stored it";
      mockStored.tags = ["set", "by", "the", "server"];
    };

    changeValue("Description", "typed description");
    changeValue("Value", "typed");
    await save(user);
    await screen.findByText("Overview panel", undefined, FIND);
    await goTo(user, "Edit");

    expect(screen.getByLabelText("Description")).toHaveValue(
      "As the server stored it",
    );
    expect(screen.getByLabelText("Value")).toHaveValue("typed");
    expect(await save(user)).toEqual(
      expect.objectContaining({ tags: ["set", "by", "the", "server"] }),
    );
  });

  it("leaves no form behind on the tab it went to", async () => {
    const user = await openEditTab();

    await save(user);
    await screen.findByText("Overview panel", undefined, FIND);

    expect(document.getElementById("name")).toBeNull();
  });

  it("starts from the save's answer even if the read after it fails", async () => {
    const user = await openEditTab();

    changeValue("Value", "typed");
    mockFailingPaths.add("events.getById");
    await save(user);
    await screen.findByText("Overview panel", undefined, FIND);
    await goTo(user, "Edit");

    expect(screen.getByLabelText("Value")).toHaveValue("typed");
  });

  it("takes what's changed from the header since, like any other visit", async () => {
    const user = await openEditTab();

    changeValue("Event Name", "typed name");
    await save(user);
    await screen.findByText("Overview panel", undefined, FIND);
    await setBadge(user, EventStatus.PAUSED);
    await goTo(user, "Edit");

    expect(screen.getByLabelText("Event Name")).toHaveValue("typed name");
    expect(selectedStatus()).toHaveTextContent("Paused");
  });

  it("keeps later edits through another trip", async () => {
    const user = await openEditTab();

    await save(user);
    await screen.findByText("Overview panel", undefined, FIND);
    await goTo(user, "Edit");
    changeValue("Value", "typed after the save");
    await goAndComeBack(user, "Logs");

    expect(screen.getByLabelText("Value")).toHaveValue("typed after the save");
  });
});

describe("a change to the event while the form is on another tab", () => {
  it("reaches a form nobody has edited, and a save doesn't undo it", async () => {
    const user = await openEditTab();

    await goTo(user, "Logs");
    await setBadge(user, EventStatus.PAUSED);
    await goTo(user, "Edit");

    expect(selectedStatus()).toHaveTextContent("Paused");
    expect(await save(user)).toEqual(
      expect.objectContaining({ status: EventStatus.PAUSED }),
    );
    expect(mockStored.status).toBe(EventStatus.PAUSED);
  });

  it("reaches the fields that weren't edited, and leaves the ones that were", async () => {
    const user = await openEditTab();

    changeValue("Value", "typed");
    changeValue("Event Name", "typed name");
    await goTo(user, "Overview");
    await setBadge(user, EventStatus.PAUSED);
    await goTo(user, "Edit");

    expect(screen.getByLabelText("Value")).toHaveValue("typed");
    expect(screen.getByLabelText("Event Name")).toHaveValue("typed name");
    expect(selectedStatus()).toHaveTextContent("Paused");
    expect(await save(user)).toEqual(
      expect.objectContaining({
        name: "typed name",
        status: EventStatus.PAUSED,
        envVars: [{ key: "FOO", value: "typed" }],
      }),
    );
  });

  it("doesn't replace a status chosen in the form", async () => {
    const user = await openEditTab();

    await user.click(selectedStatus());
    await user.click(await screen.findByRole("option", { name: "Draft" }));
    await goTo(user, "Logs");
    await setBadge(user, EventStatus.PAUSED);
    await goTo(user, "Edit");

    expect(selectedStatus()).toHaveTextContent("Draft");
    expect(await save(user)).toEqual(
      expect.objectContaining({ status: EventStatus.DRAFT }),
    );
  });

  it("follows each change, not only the first", async () => {
    const user = await openEditTab();

    await goTo(user, "Logs");
    await setBadge(user, EventStatus.PAUSED);
    await goTo(user, "Edit");
    expect(selectedStatus()).toHaveTextContent("Paused");

    changeValue("Event Name", "typed name");
    await goTo(user, "Logs");
    await setBadge(user, EventStatus.ACTIVE);
    await goTo(user, "Edit");

    expect(selectedStatus()).toHaveTextContent("Active");
    expect(screen.getByLabelText("Event Name")).toHaveValue("typed name");
  });

  it("brings in a write from elsewhere the same way", async () => {
    const user = await openEditTab();

    changeValue("Event Name", "typed name");
    await goTo(user, "Overview");
    changedElsewhere({
      name: "renamed elsewhere",
      description: "Changed elsewhere",
      tags: ["elsewhere"],
      servers: [SECOND],
      envVars: storedVariables([{ key: "FOO", value: "changed elsewhere" }]),
    });
    await readAgain(user);
    await goTo(user, "Edit");

    expect(screen.getByLabelText("Event Name")).toHaveValue("typed name");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Changed elsewhere",
    );
    expect(screen.getByLabelText("Value")).toHaveValue("changed elsewhere");
    expect(screen.getByRole("checkbox", { name: SECOND_SERVER })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: SANDBOX_SERVER }),
    ).not.toBeChecked();
    expect(await save(user)).toEqual(
      expect.objectContaining({
        name: "typed name",
        tags: ["elsewhere"],
        selectedServerIds: [7],
      }),
    );
  });

  it("reaches every field the form holds", async () => {
    const user = await openEditTab();

    await goTo(user, "Overview");
    const startTime = new Date("2027-03-04T05:06:00.000Z");
    changedElsewhere({
      description: "Changed",
      shared: true,
      content: "echo changed",
      triggerType: EventTriggerType.SCHEDULE,
      scheduleNumber: 9,
      scheduleUnit: TimeUnit.DAYS,
      startTime,
      customSchedule: "0 0 * * *",
      timezone: "Asia/Tokyo",
      catchupPolicy: CatchupPolicy.RUN_ONCE,
      overlapPolicy: OverlapPolicy.SKIP,
      priority: 3,
      timeoutValue: 7,
      timeoutUnit: TimeUnit.MINUTES,
      runLocation: RunLocation.REMOTE,
      retries: 2,
      maxExecutions: 4,
      resetCounterOnActive: true,
      tags: ["changed"],
      servers: [SECOND],
      envVars: storedVariables([{ key: "BAR", value: "changed" }]),
    });
    await readAgain(user);
    await goTo(user, "Edit");

    expect(await save(user)).toEqual(
      expect.objectContaining({
        description: "Changed",
        shared: true,
        content: "echo changed",
        triggerType: EventTriggerType.SCHEDULE,
        scheduleNumber: 9,
        scheduleUnit: TimeUnit.DAYS,
        startTime: startTime.toISOString(),
        customSchedule: "0 0 * * *",
        timezone: "Asia/Tokyo",
        catchupPolicy: CatchupPolicy.RUN_ONCE,
        overlapPolicy: OverlapPolicy.SKIP,
        priority: 3,
        timeoutValue: 7,
        timeoutUnit: TimeUnit.MINUTES,
        runLocation: RunLocation.REMOTE,
        retries: 2,
        maxExecutions: 4,
        resetCounterOnActive: true,
        tags: ["changed"],
        selectedServerIds: [7],
        envVars: [{ key: "BAR", value: "changed" }],
      }),
    );
  });

  it("reaches HTTP fields", async () => {
    mockStored = httpEvent();
    const user = await openEditTab();

    await goTo(user, "Overview");
    changedElsewhere({
      httpMethod: "PUT",
      httpUrl: "https://example.test/changed",
      httpHeaders: [{ key: "X-Key", value: "changed" }],
      httpBody: '{"a":2}',
    });
    await readAgain(user);
    await goTo(user, "Edit");

    expect(screen.getByLabelText("Request URL")).toHaveValue(
      "https://example.test/changed",
    );
    expect(await save(user)).toEqual(
      expect.objectContaining({
        httpMethod: "PUT",
        httpUrl: "https://example.test/changed",
        httpHeaders: [{ key: "X-Key", value: "changed" }],
        httpBody: '{"a":2}',
      }),
    );
  });

  it("reaches a tool action's settings", async () => {
    mockStored = toolEvent();
    const user = await openEditTab();
    await waitFor(
      () => expect(document.getElementById("channel")).toHaveValue("#stored"),
      FIND,
    );

    await goTo(user, "Overview");
    changedElsewhere({
      toolActionConfig: {
        toolType: "SLACK",
        toolId: 1,
        actionId: "slack-send-message",
        parameters: { channel: "#changed" },
      },
    });
    await readAgain(user);
    await goTo(user, "Edit");

    await waitFor(
      () => expect(document.getElementById("channel")).toHaveValue("#changed"),
      FIND,
    );
  });

  it("gives a script stored later to an event that only had the template", async () => {
    mockStored = { ...scriptEvent(), content: null };
    const user = await openEditTab();
    expect(screen.getByLabelText("Script")).toHaveValue(
      getDefaultScriptContent(EventType.BASH),
    );

    await goTo(user, "Overview");
    changedElsewhere({ content: "echo written elsewhere" });
    await readAgain(user);
    await goTo(user, "Edit");

    expect(screen.getByLabelText("Script")).toHaveValue(
      "echo written elsewhere",
    );
  });

  it("leaves a script written after changing the type alone", async () => {
    const user = await openEditTab();

    await user.click(screen.getByRole("combobox", { name: "Event Type" }));
    await user.click(await screen.findByRole("option", { name: "Python" }));
    changeValue("Script", "print('typed')");
    await goTo(user, "Overview");
    changedElsewhere({ content: "echo elsewhere" });
    await readAgain(user);
    await goTo(user, "Edit");

    expect(screen.getByLabelText("Script")).toHaveValue("print('typed')");
  });

  it("gives a stored type change its own stored script, not a template", async () => {
    const user = await openEditTab();

    await goTo(user, "Overview");
    changedElsewhere({ type: EventType.PYTHON, content: "print('elsewhere')" });
    await readAgain(user);
    await goTo(user, "Edit");

    expect(
      screen.getByRole("combobox", { name: "Event Type" }),
    ).toHaveTextContent("Python");
    expect(screen.getByLabelText("Script")).toHaveValue("print('elsewhere')");
  });
});
