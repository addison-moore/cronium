/**
 * Whatever changes an event has to change the copy React Query holds, because the
 * edit form starts from that copy and saving the form sends all of it back. A stale
 * copy doesn't only look wrong: the next save puts the old values back on the server
 * and reports success.
 *
 * Only the network is fake here. `TrpcProvider`'s real QueryClient and tRPC's real
 * hooks run against a row in memory, because what's being tested is what the cache
 * does, and mocking `useQuery` would replace exactly that. The answers come from the
 * real `toEventApiDto`, so they have the shape the real server gives them.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { focusManager, useQueryClient } from "@tanstack/react-query";

interface Request {
  path: string;
  input: Record<string, unknown>;
}

let mockStored: Record<string, unknown>;
const mockRequests: Request[] = [];
/** Paths that wait for the test to let them through, and the requests waiting. */
const mockHeldPaths = new Set<string>();
let mockReleaseHeld: Array<() => void> = [];
const mockFailingPaths = new Set<string>();
const mockModalToast = jest.fn();
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

/**
 * What the server would answer. An answer is settled when the request arrives, so
 * one that's held for a while comes back with what the row held when it left.
 */
async function mockAnswer(request: Request): Promise<unknown> {
  mockRequests.push(request);
  if (mockFailingPaths.has(request.path)) {
    throw new Error(`${request.path} failed`);
  }
  const answer = mockServerAnswer(request);
  if (mockHeldPaths.has(request.path)) {
    await new Promise<void>((resolve) => mockReleaseHeld.push(resolve));
  }
  return answer;
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
  useAuth: () => ({ user: { id: "owner" } }),
}));

jest.mock("@/hooks/use-logs-socket", () => ({
  useLogsSocket: () => mockSocket,
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
    // Called later, because this factory runs before that variable has its value.
    toast: (...args: unknown[]) => mockModalToast(...args) as unknown,
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
import { TrpcProvider } from "@/components/providers/TrpcProvider";
import { EventDetailsPopover } from "@/components/ui/event-details-popover";
import { trpc } from "@/lib/trpc";
import { toEventApiDto } from "@/server/security/api-dto";
import type { EventWithRelations } from "@/server/storage";
import {
  EventStatus,
  EventTriggerType,
  EventType,
  RunLocation,
  TimeUnit,
} from "@/shared/schema";

// Each test renders the whole form more than once, and CI runs with coverage.
jest.setTimeout(120_000);

const OWNER = "owner";
const EVENT_ID = 42;
const FIND = { timeout: 60_000 };
const NEXT_RUN = new Date("2027-01-02T03:04:05.000Z");

function storedEvent(): Record<string, unknown> {
  return {
    id: EVENT_ID,
    userId: OWNER,
    name: "nightly",
    description: "Before",
    shared: false,
    type: EventType.BASH,
    content: "true",
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
    priority: 1,
    runLocation: RunLocation.LOCAL,
    serverId: null,
    timeoutValue: 30,
    timeoutUnit: TimeUnit.SECONDS,
    retries: 0,
    startTime: null,
    maxExecutions: 0,
    resetCounterOnActive: false,
    executionCount: 3,
    tags: ["before"],
    lastRunAt: null,
    nextRunAt: null,
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    updatedAt: new Date("2026-01-02T03:04:05.000Z"),
    servers: [],
    envVars: storedVariables([{ key: "FOO", value: "bar" }]),
  };
}

/** Variables as storage returns them: the values are ciphertext until the DTO. */
function storedVariables(variables: Array<{ key: string; value: string }>) {
  return variables.map(({ key, value }, index) => ({
    id: index + 1,
    eventId: EVENT_ID,
    key,
    value: `ciphertext:${value}`,
  }));
}

function eventDto() {
  return toEventApiDto(mockStored as unknown as EventWithRelations, OWNER, {
    revealEnvVarValues: true,
  });
}

function mockServerAnswer({ path, input }: Request): unknown {
  switch (path) {
    case "events.getById":
      return eventDto();
    case "events.update": {
      const { id: _id, envVars, selectedServerIds: _ids, ...fields } = input;
      Object.assign(mockStored, fields, {
        ...(Array.isArray(envVars) && {
          envVars: storedVariables(
            envVars as Array<{ key: string; value: string }>,
          ),
        }),
      });
      // The real one works out the schedule after reading the row it answers with.
      const answer = eventDto();
      mockStored.nextRunAt = NEXT_RUN;
      return answer;
    }
    case "events.activate":
      mockStored.status = EventStatus.ACTIVE;
      return { success: true };
    case "events.deactivate":
      mockStored.status = EventStatus.PAUSED;
      return { success: true };
    case "events.resetCounter":
      mockStored.executionCount = 0;
      return { success: true };
    case "events.getLogs":
      return { logs: [] };
    case "servers.getAll":
      return { servers: [] };
    case "servers.getGroups":
      return { groups: [] };
    case "tools.getAll":
      return { tools: [] };
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

function letTimePass(ms: number) {
  clockOffset += ms;
}

/** The page a test is on. A change of page keeps the QueryClient, as navigating does. */
function App({ page }: { page: React.ReactElement }) {
  return (
    <TrpcProvider>
      <WithoutRetries />
      {page}
    </TrpcProvider>
  );
}

/** A failure would otherwise spend 7 seconds on react-query's retries. */
function WithoutRetries() {
  useQueryClient().setDefaultOptions({ queries: { retry: false } });
  return null;
}

const workflowNode = (
  <EventDetailsPopover
    eventId={EVENT_ID}
    eventName="nightly"
    eventType={EventType.BASH}
  >
    <button>Event details</button>
  </EventDetailsPopover>
);

function eventPageOnEditTab() {
  window.location.hash = "#edit";
  return <EventDetails eventId={String(EVENT_ID)} />;
}

/** Stands in for the events list and the rest, which only call the mutations. */
function EventActions() {
  const update = trpc.events.update.useMutation();
  const activate = trpc.events.activate.useMutation();
  const deactivate = trpc.events.deactivate.useMutation();
  const resetCounter = trpc.events.resetCounter.useMutation();
  const id = EVENT_ID;
  return (
    <>
      <button onClick={() => update.mutate({ id, status: EventStatus.DRAFT })}>
        Set to draft
      </button>
      <button onClick={() => activate.mutate({ id, resetCounter: false })}>
        Activate
      </button>
      <button onClick={() => deactivate.mutate({ id })}>Pause</button>
      <button onClick={() => resetCounter.mutate({ id })}>Reset counter</button>
      <p>
        Finished:{" "}
        {[update, activate, deactivate, resetCounter].some((m) => m.isSuccess)
          ? "yes"
          : "no"}
      </p>
    </>
  );
}

/** Something on screen reading the event, as the event page's Overview tab does. */
function EventReader() {
  const { data, refetch } = trpc.events.getById.useQuery({ id: EVENT_ID });
  const update = trpc.events.update.useMutation();
  return (
    <>
      <p>
        Showing: {data?.name ?? "nothing yet"}, run {data?.executionCount ?? 0}{" "}
        times
      </p>
      <p>Next run: {data?.nextRunAt ? "scheduled" : "none"}</p>
      <p>Status: {data?.status ?? "unknown"}</p>
      <button onClick={() => void refetch()}>Read again</button>
      <button onClick={() => update.mutate({ id: EVENT_ID, name: "renamed" })}>
        Rename
      </button>
    </>
  );
}

function setUp(page: React.ReactElement) {
  const view = render(<App page={page} />);
  return {
    user: userEvent.setup(),
    goTo: (next: React.ReactElement) => view.rerender(<App page={next} />),
  };
}

async function openModal(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "Event details" }));
  await user.click(
    await screen.findByRole("button", { name: "Edit Event" }, FIND),
  );
}

const nameField = () => screen.findByLabelText("Event Name", undefined, FIND);
const descriptionField = () =>
  screen.findByLabelText("Description", undefined, FIND);

async function replaceText(
  user: UserEvent,
  field: HTMLElement,
  replacement: string,
) {
  await user.clear(field);
  await user.type(field, replacement);
}

async function addTag(user: UserEvent, tag: string) {
  await user.type(
    screen.getByPlaceholderText("Add tags to organize your events..."),
    `${tag}{Enter}`,
  );
}

const dialogToClose = () =>
  waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), FIND);

async function saveAndWaitForClose(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "Update Event" }));
  await dialogToClose();
}

/** Open the modal and leave without saving, which leaves a copy in the cache. */
async function openAndCancel(user: UserEvent) {
  await openModal(user);
  await nameField();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await dialogToClose();
}

const letHeldRequestsThrough = () =>
  act(async () => {
    mockHeldPaths.clear();
    mockReleaseHeld.splice(0).forEach((release) => release());
  });

const SAVED_FIELDS = {
  name: "renamed",
  description: "After",
  tags: ["before", "after"],
};

/**
 * Open the modal and change fields of both kinds: the name and description the form
 * reads once when it mounts, and the tags and variables it reads again on a new copy.
 */
async function editInModalAndSave(user: UserEvent) {
  await openModal(user);
  await replaceText(user, await nameField(), SAVED_FIELDS.name);
  await replaceText(user, await descriptionField(), SAVED_FIELDS.description);
  await addTag(user, "after");
  await replaceText(user, screen.getByDisplayValue("bar"), "changed-in-modal");
  await saveAndWaitForClose(user);
  expect(mockStored).toMatchObject(SAVED_FIELDS);
  expect(variableValues()).toEqual(["changed-in-modal"]);
}

function variableValues() {
  return (mockStored.envVars as Array<{ value: string }>).map(({ value }) =>
    value.replace(/^ciphertext:/, ""),
  );
}

describe("the copy of an event the edit form starts from", () => {
  beforeEach(() => {
    mockStored = storedEvent();
    mockRequests.length = 0;
    mockHeldPaths.clear();
    mockReleaseHeld = [];
    mockFailingPaths.clear();
    mockModalToast.mockClear();
    clockOffset = 0;
    clock = jest
      .spyOn(Date, "now")
      .mockImplementation(() => realNow() + clockOffset);
  });

  afterEach(() => {
    clock.mockRestore();
    window.location.hash = "";
    focusManager.setFocused(undefined);
  });

  describe("the workflow's edit modal", () => {
    it("reopens with what the last save wrote", async () => {
      const { user } = setUp(workflowNode);
      await editInModalAndSave(user);

      await openModal(user);

      expect(await nameField()).toHaveValue("renamed");
      expect(await descriptionField()).toHaveValue("After");
      expect(screen.getByText("after")).toBeInTheDocument();
      expect(screen.getByDisplayValue("changed-in-modal")).toBeInTheDocument();
    });

    it("doesn't put the old values back on a second save", async () => {
      const { user } = setUp(workflowNode);
      await editInModalAndSave(user);

      await openModal(user);
      await nameField();
      await saveAndWaitForClose(user);

      expect(sent("events.update")).toHaveLength(2);
      expect(sent("events.update")[1]).toMatchObject({
        ...SAVED_FIELDS,
        envVars: [{ key: "FOO", value: "changed-in-modal" }],
      });
      expect(mockStored).toMatchObject(SAVED_FIELDS);
      expect(variableValues()).toEqual(["changed-in-modal"]);
    });

    // The row changes behind this tab's back, so the only way to see it is to ask.
    it.each([
      ["15 seconds", 15_000],
      ["90 seconds", 90_000],
      ["6 minutes", 6 * 60_000],
    ])(
      "shows every field as it is now when reopened %s after another tab saved",
      async (_name, elapsed) => {
        const { user } = setUp(workflowNode);
        await openAndCancel(user);

        changedElsewhere({
          name: "from another tab",
          description: "Elsewhere",
          tags: ["elsewhere"],
          envVars: storedVariables([{ key: "FOO", value: "elsewhere-value" }]),
        });
        letTimePass(elapsed);
        await openModal(user);

        await waitFor(
          () => expect(screen.getByText("elsewhere")).toBeInTheDocument(),
          FIND,
        );
        expect(await nameField()).toHaveValue("from another tab");
        expect(await descriptionField()).toHaveValue("Elsewhere");
        expect(screen.getByDisplayValue("elsewhere-value")).toBeInTheDocument();
      },
    );

    it("waits for the event as it is now instead of starting from the old copy", async () => {
      const { user } = setUp(workflowNode);
      await openAndCancel(user);

      changedElsewhere({ name: "from another tab" });
      mockHeldPaths.add("events.getById");
      await openModal(user);

      expect(
        await screen.findByText("Loading event data...", undefined, FIND),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Event Name")).toBeNull();

      await letHeldRequestsThrough();

      expect(await nameField()).toHaveValue("from another tab");
    });

    it("says it couldn't load the event rather than offering an old copy to save", async () => {
      const { user } = setUp(workflowNode);
      await openAndCancel(user);

      mockFailingPaths.add("events.getById");
      await openModal(user);

      expect(
        await screen.findByText("Failed to load event data", undefined, FIND),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Event Name")).toBeNull();
      expect(screen.queryByRole("button", { name: "Update Event" })).toBeNull();

      expect(mockModalToast).toHaveBeenCalledTimes(1);
      expect(mockModalToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "events.getById failed" }),
      );

      // The dialog has no X and ignores a click outside it.
      await user.click(screen.getByRole("button", { name: "Close" }));
      await dialogToClose();
    });

    it("recovers on the next opening after a refresh failed", async () => {
      const { user } = setUp(workflowNode);
      await openAndCancel(user);

      mockFailingPaths.add("events.getById");
      await openModal(user);
      await screen.findByText("Failed to load event data", undefined, FIND);
      await user.keyboard("{Escape}");
      await dialogToClose();

      // The query still holds that error while this opening reads again.
      mockFailingPaths.clear();
      mockHeldPaths.add("events.getById");
      await openModal(user);

      expect(
        await screen.findByText("Loading event data...", undefined, FIND),
      ).toBeInTheDocument();
      expect(mockModalToast).toHaveBeenCalledTimes(1);

      await letHeldRequestsThrough();

      expect(await nameField()).toHaveValue("nightly");
      expect(mockModalToast).toHaveBeenCalledTimes(1);
    });

    it("leaves unsaved edits alone when the window regains focus", async () => {
      const { user } = setUp(workflowNode);
      await openModal(user);
      await nameField();
      await addTag(user, "unsaved");
      const reads = sent("events.getById").length;

      letTimePass(90_000);
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });

      await waitFor(() =>
        expect(sent("events.getById").length).toBeGreaterThan(reads),
      );
      expect(screen.getByText("unsaved")).toBeInTheDocument();
    });

    it("keeps the form and says nothing when a read fails once it's open", async () => {
      const { user } = setUp(workflowNode);
      await openModal(user);
      await nameField();
      await addTag(user, "unsaved");
      const reads = sent("events.getById").length;

      mockFailingPaths.add("events.getById");
      letTimePass(90_000);
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() =>
        expect(sent("events.getById").length).toBeGreaterThan(reads),
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(screen.getByText("unsaved")).toBeInTheDocument();
      expect(screen.queryByText("Failed to load event data")).toBeNull();
      expect(mockModalToast).not.toHaveBeenCalled();
    });

    it("keeps the edits on screen when the save fails, and shows the server's values next time", async () => {
      const { user } = setUp(workflowNode);
      await openModal(user);
      await replaceText(user, await nameField(), "not saved");

      mockFailingPaths.add("events.update");
      await user.click(screen.getByRole("button", { name: "Update Event" }));
      await waitFor(() => expect(sent("events.update")).toHaveLength(1), FIND);

      expect(await nameField()).toHaveValue("not saved");

      mockFailingPaths.clear();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await dialogToClose();
      await openModal(user);

      expect(await nameField()).toHaveValue("nightly");
    });
  });

  describe("everything else reading the same copy", () => {
    it("shows the modal's save on the event page's Edit tab", async () => {
      const { user, goTo } = setUp(workflowNode);
      await editInModalAndSave(user);

      goTo(eventPageOnEditTab());

      expect(await nameField()).toHaveValue("renamed");
      expect(await descriptionField()).toHaveValue("After");
    });

    it("shows the modal's save on the /edit page", async () => {
      const { user, goTo } = setUp(workflowNode);
      await editInModalAndSave(user);

      goTo(<EditEventPage />);

      expect(await nameField()).toHaveValue("renamed");
      expect(await descriptionField()).toHaveValue("After");
    });

    it("shows a save from the /edit page on the event page it goes to", async () => {
      const { user, goTo } = setUp(<EditEventPage />);
      await replaceText(user, await nameField(), "renamed");
      await user.click(screen.getByRole("button", { name: "Update Event" }));
      await waitFor(() => expect(sent("events.update")).toHaveLength(1), FIND);

      goTo(eventPageOnEditTab());

      expect(await nameField()).toHaveValue("renamed");
    });

    it.each([
      ["Set to draft", EventStatus.ACTIVE, EventStatus.DRAFT],
      ["Pause", EventStatus.ACTIVE, EventStatus.PAUSED],
      ["Activate", EventStatus.PAUSED, EventStatus.ACTIVE],
    ])(
      "doesn't undo %s from the events list when the event is saved next",
      async (button, before, after) => {
        mockStored.status = before;
        const { user, goTo } = setUp(eventPageOnEditTab());
        await nameField();

        window.location.hash = "";
        goTo(<EventActions />);
        await user.click(screen.getByRole("button", { name: button }));
        await screen.findByText("Finished: yes", undefined, FIND);

        goTo(eventPageOnEditTab());
        await nameField();
        await user.click(screen.getByRole("button", { name: "Update Event" }));
        await waitFor(
          () => expect(sent("events.update").length).toBeGreaterThan(0),
          FIND,
        );

        expect(sent("events.update").at(-1)).toMatchObject({ status: after });
        expect(mockStored.status).toBe(after);
      },
    );

    it("updates what's on screen without waiting for another read", async () => {
      const { user } = setUp(<EventReader />);
      await screen.findByText("Showing: nightly, run 3 times", undefined, FIND);

      mockHeldPaths.add("events.getById");
      await user.click(screen.getByRole("button", { name: "Rename" }));

      expect(
        await screen.findByText(
          "Showing: renamed, run 3 times",
          undefined,
          FIND,
        ),
      ).toBeInTheDocument();
    });

    it("isn't overwritten by a read that left before the save", async () => {
      const { user } = setUp(<EventReader />);
      await screen.findByText("Showing: nightly, run 3 times", undefined, FIND);

      mockHeldPaths.add("events.getById");
      await user.click(screen.getByRole("button", { name: "Read again" }));
      await waitFor(() => expect(sent("events.getById")).toHaveLength(2), FIND);

      await user.click(screen.getByRole("button", { name: "Rename" }));
      await screen.findByText("Showing: renamed, run 3 times", undefined, FIND);

      await letHeldRequestsThrough();
      // Long enough for a late answer to have landed, and for the read after it.
      await waitFor(
        () => expect(sent("events.getById").length).toBeGreaterThan(2),
        FIND,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(
        screen.getByText("Showing: renamed, run 3 times"),
      ).toBeInTheDocument();
    });

    // Nothing is showing this one, so reading again wouldn't replace it for the next page.
    it("isn't overwritten by a read still on its way from a page that's been left", async () => {
      const { user, goTo } = setUp(<EventReader />);
      await screen.findByText(`Status: ${EventStatus.ACTIVE}`, undefined, FIND);

      mockHeldPaths.add("events.getById");
      await user.click(screen.getByRole("button", { name: "Read again" }));
      await waitFor(() => expect(sent("events.getById")).toHaveLength(2), FIND);
      goTo(<EventActions />);

      await user.click(screen.getByRole("button", { name: "Set to draft" }));
      await screen.findByText("Finished: yes", undefined, FIND);
      await letHeldRequestsThrough();

      mockHeldPaths.add("events.getById");
      goTo(<EventReader />);

      expect(
        await screen.findByText(
          `Status: ${EventStatus.DRAFT}`,
          undefined,
          FIND,
        ),
      ).toBeInTheDocument();
    });

    it("reads the event again after a save, whose answer comes before the schedule does", async () => {
      const { user } = setUp(<EventReader />);
      await screen.findByText("Next run: none", undefined, FIND);

      await user.click(screen.getByRole("button", { name: "Rename" }));

      expect(
        await screen.findByText("Next run: scheduled", undefined, FIND),
      ).toBeInTheDocument();
    });

    it("reads the event again after a write that doesn't answer with the row", async () => {
      const { user } = setUp(
        <>
          <EventReader />
          <EventActions />
        </>,
      );
      await screen.findByText("Showing: nightly, run 3 times", undefined, FIND);

      await user.click(screen.getByRole("button", { name: "Reset counter" }));

      expect(
        await screen.findByText(
          "Showing: nightly, run 0 times",
          undefined,
          FIND,
        ),
      ).toBeInTheDocument();
    });
  });
});
