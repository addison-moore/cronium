/**
 * A save from a workflow page's edit modal has to show everywhere that page shows the
 * event: the Overview tab's graph, the canvas's nodes and the canvas's sidebar. All
 * three get it from `events.getAll`, and the canvas also holds its own copy of a node.
 *
 * Only the network is fake here. The page, the canvas on real React Flow, the modal and
 * the form run over `TrpcProvider`'s real QueryClient. The answers come from the real
 * DTOs, in the order and at the limit the real list uses, against rows in memory.
 */
import React, { Suspense } from "react";
import {
  act,
  createEvent,
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

type Row = Record<string, unknown>;

let mockEvents: Map<number, Row>;
let mockWorkflowNodes: Array<{ id: number; eventId: number }>;
const mockRequests: Request[] = [];
/** Paths that wait for the test to let them through, and the requests waiting. */
const mockHeldPaths = new Set<string>();
let mockReleaseHeld: Array<() => void> = [];
const mockFailingPaths = new Set<string>();

// Stands in for AES: storage hands the API ciphertext, and only the DTO decrypts.
jest.mock("@/lib/security/field-secret", () => ({
  decryptEnvVarValue: (stored: string) => stored.replace(/^ciphertext:/, ""),
}));

/** An answer is settled when the request arrives, so a held one comes back old. */
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

const mockRouter = { push: jest.fn(), refresh: jest.fn() };
jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "9" }),
  useRouter: () => mockRouter,
  usePathname: () => "/dashboard/workflows/9",
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}));

// next/dynamic would load these a tick later, for no benefit here.
jest.mock("@/components/event-form/EventForm-lazy", () => ({
  __esModule: true,
  default: jest.requireActual<
    typeof import("@/components/event-form/EventForm")
  >("@/components/event-form/EventForm").default,
}));
jest.mock("@/components/workflows/WorkflowCanvas-lazy", () => ({
  __esModule: true,
  default: jest.requireActual<
    typeof import("@/components/workflows/WorkflowCanvas")
  >("@/components/workflows/WorkflowCanvas").default,
}));

// A backdrop and a minimap, whose sums come out as NaN in jsdom and fill the log.
jest.mock("@xyflow/react", () => ({
  ...jest.requireActual<typeof import("@xyflow/react")>("@xyflow/react"),
  Background: () => null,
  MiniMap: () => null,
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

// The rest of the page isn't what's being tested, and needs a lot of it.
jest.mock("@/components/workflows/WorkflowExecutionHistory", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/workflows/WorkflowDetailsForm", () => ({
  __esModule: true,
  default: () => null,
}));

import WorkflowDetailsPage from "../page";
import { TrpcProvider } from "@/components/providers/TrpcProvider";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import {
  toEventApiDto,
  toEventListApiDto,
  toWorkflowApiDto,
} from "@/server/security/api-dto";
import type { EventWithRelations } from "@/server/storage";
import {
  ConnectionType,
  EventStatus,
  EventTriggerType,
  EventType,
  RunLocation,
  TimeUnit,
  WorkflowTriggerType,
} from "@/shared/schema";

// Each test renders the whole form, and CI runs with coverage.
jest.setTimeout(120_000);

const OWNER = "owner";
const WORKFLOW_ID = 9;
const NIGHTLY = 42;
const WEEKLY = 43;
const SPARE = 44;
const FIND = { timeout: 60_000 };
const CREATED_AT = new Date("2026-01-02T03:04:05.000Z");
const STORED_AT = new Date("2026-02-03T04:05:06.000Z");
const SAVED_AT = new Date("2026-11-06T07:08:09.000Z");

function storedEvent(id: number, fields: Row): Row {
  return {
    id,
    userId: OWNER,
    name: `event ${id}`,
    description: null,
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
    executionCount: 0,
    tags: [],
    lastRunAt: null,
    nextRunAt: null,
    createdAt: CREATED_AT,
    updatedAt: STORED_AT,
    servers: [],
    envVars: [],
    ...fields,
  };
}

function eventDto(row: Row) {
  return toEventApiDto(row as unknown as EventWithRelations, OWNER, {
    revealEnvVarValues: true,
  });
}

/** The real one orders by `updated_at`, newest first, and stops at the limit. */
function eventList({ limit, offset }: Record<string, unknown>) {
  const rows = [...mockEvents.values()].sort(
    (a, b) =>
      (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime() ||
      (b.id as number) - (a.id as number),
  );
  const page = rows.slice(
    offset as number,
    (offset as number) + (limit as number),
  );
  return {
    events: page.map((row) =>
      toEventListApiDto({ ...row, eventServers: [] } as never, OWNER),
    ),
    total: rows.length,
    hasMore: rows.length > (offset as number) + (limit as number),
  };
}

function workflowDto() {
  return toWorkflowApiDto(
    {
      id: WORKFLOW_ID,
      userId: OWNER,
      name: "Deploy",
      description: null,
      triggerType: WorkflowTriggerType.MANUAL,
      status: EventStatus.ACTIVE,
      tags: [],
      shared: false,
      webhookKey: null,
      webhookKeyHash: null,
      overrideEventServers: false,
      overrideServerIds: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      nodes: mockWorkflowNodes.map(({ id, eventId }) => ({
        id,
        workflowId: WORKFLOW_ID,
        eventId,
        position_x: id * 300,
        position_y: 100,
        event: mockEvents.get(eventId),
      })),
      connections:
        mockWorkflowNodes.length > 1
          ? [
              {
                id: 1,
                workflowId: WORKFLOW_ID,
                sourceNodeId: mockWorkflowNodes[0]!.id,
                targetNodeId: mockWorkflowNodes[1]!.id,
                connectionType: ConnectionType.ALWAYS,
              },
            ]
          : [],
    } as never,
    OWNER,
  );
}

function mockServerAnswer({ path, input }: Request): unknown {
  switch (path) {
    case "events.getAll":
      return eventList(input);
    case "events.getById":
      return eventDto(mockEvents.get(input.id as number)!);
    case "events.update": {
      const { id, envVars: _vars, selectedServerIds: _ids, ...fields } = input;
      const row = mockEvents.get(id as number)!;
      Object.assign(row, fields);
      // The real one answers, then works out the schedule, which writes `updated_at`.
      const answer = eventDto(row);
      row.updatedAt = SAVED_AT;
      return answer;
    }
    case "workflows.getById":
      return { data: workflowDto() };
    case "workflows.getExecutions":
      return { executions: { executions: [], total: 0 }, hasMore: false };
    case "workflows.update":
      return workflowDto();
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

const letHeldRequestsThrough = () =>
  act(async () => {
    mockHeldPaths.clear();
    mockReleaseHeld.splice(0).forEach((release) => release());
  });

/** A failure would otherwise spend 7 seconds on react-query's retries. */
function WithoutRetries() {
  useQueryClient().setDefaultOptions({ queries: { retry: false } });
  return null;
}

const params = Promise.resolve({ id: String(WORKFLOW_ID) });
const workflowPage = (
  <Suspense fallback={null}>
    <WorkflowDetailsPage params={params} />
  </Suspense>
);

function App({ page }: { page: React.ReactElement }) {
  return (
    <TrpcProvider>
      <WithoutRetries />
      {page}
    </TrpcProvider>
  );
}

async function openPage(tab: "overview" | "canvas") {
  window.location.hash = `#${tab}`;
  const view = await act(async () => render(<App page={workflowPage} />));
  return {
    user: userEvent.setup(),
    goTo: (next: React.ReactElement) =>
      act(async () => view.rerender(<App page={next} />)),
  };
}

const openTab = async (user: UserEvent, name: "Overview" | "Canvas") =>
  user.click(await screen.findByRole("tab", { name }, FIND));

/** Somewhere the page shows an event, and how to reach its (i) button from there. */
interface Surface {
  find: (name: string) => Promise<HTMLElement>;
  infoButton: (shown: HTMLElement) => HTMLElement;
  tab: "overview" | "canvas";
}

const canvasNodes = () => [
  ...document.querySelectorAll<HTMLElement>(".react-flow__node"),
];

const graph: Surface = {
  tab: "overview",
  find: (name) => screen.findByTitle(name, undefined, FIND),
  infoButton: (shown) => within(shown.parentElement!).getByRole("button"),
};

const canvasNode: Surface = {
  tab: "canvas",
  find: (name) =>
    waitFor(() => {
      const node = canvasNodes().find((n) => n.textContent?.includes(name));
      expect(node).toBeDefined();
      return node!;
    }, FIND),
  infoButton: (shown) => within(shown).getByRole("button"),
};

const sidebarPanel = async () =>
  (await screen.findByText("Available Events", undefined, FIND)).closest(
    ".react-flow__panel",
  ) as HTMLElement;

const sidebar: Surface = {
  tab: "canvas",
  find: async (name) =>
    (
      await within(await sidebarPanel()).findByText(name, undefined, FIND)
    ).closest("li") as HTMLElement,
  infoButton: (shown) => within(shown).getByRole("button"),
};

/**
 * On a node this can't be `user.click`: React Flow's drag handler sees every press there
 * and reads the document from the event's `view`, which user-event leaves empty.
 */
const clickOnCanvas = (element: HTMLElement) => fireEvent.click(element);

async function openPopover(surface: Surface, name: string) {
  clickOnCanvas(surface.infoButton(await surface.find(name)));
  return screen.findByRole("dialog", undefined, FIND);
}

const dialogToClose = () =>
  waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), FIND);

async function closePopover(user: UserEvent) {
  await user.keyboard("{Escape}");
  await dialogToClose();
}

const nameField = () => screen.findByLabelText("Event Name", undefined, FIND);
const descriptionField = () =>
  screen.findByLabelText("Description", undefined, FIND);
const tagField = () =>
  screen.getByPlaceholderText("Add tags to organize your events...");

async function replaceText(
  user: UserEvent,
  field: HTMLElement,
  replacement: string,
) {
  await user.clear(field);
  if (replacement) await user.type(field, replacement);
}

/** Open the modal from the (i) button, change what `edit` changes, and save. */
async function saveFromModal(
  user: UserEvent,
  surface: Surface,
  name: string,
  edit: () => Promise<void>,
) {
  const popover = await openPopover(surface, name);
  await user.click(within(popover).getByRole("button", { name: "Edit Event" }));
  await nameField();
  await edit();
  const saves = sent("events.update").length;
  await user.click(screen.getByRole("button", { name: "Update Event" }));
  await waitFor(
    () => expect(sent("events.update")).toHaveLength(saves + 1),
    FIND,
  );
  await dialogToClose();
}

const rename = (user: UserEvent, to: string) => async () =>
  replaceText(user, await nameField(), to);

/** Reads what the popover says, closing it even if it doesn't say that. */
async function expectPopover(
  user: UserEvent,
  surface: Surface,
  name: string,
  check: (popover: HTMLElement) => void,
) {
  const popover = await openPopover(surface, name);
  try {
    check(popover);
  } finally {
    await closePopover(user);
  }
}

/** For a change with nothing else on screen to wait on: there's no new label to see. */
const popoverToSay = (
  user: UserEvent,
  surface: Surface,
  name: string,
  check: (popover: HTMLElement) => void,
) => waitFor(() => expectPopover(user, surface, name, check), FIND);

const saveButton = () => screen.getByRole("button", { name: "Save" });
const undoButton = () => screen.getByRole("button", { name: "Undo" });
const undoAllButton = () =>
  screen.getByRole("button", { name: "Undo all changes" });

/** The canvas ignores edits for its first moments, and enables this when it's done. */
const canvasToSettle = () =>
  waitFor(() => expect(undoAllButton()).toBeEnabled(), FIND);

async function deleteNode(user: UserEvent, name: string) {
  clickOnCanvas(await canvasNode.find(name));
  const remove = screen.getByRole("button", { name: "Delete selected" });
  await waitFor(() => expect(remove).toBeEnabled(), FIND);
  await user.click(remove);
  await waitFor(
    () =>
      expect(canvasNodes().some((n) => n.textContent?.includes(name))).toBe(
        false,
      ),
    FIND,
  );
}

/** Long enough for a late answer to have landed. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

/** Leave the window and come back, which reads the workflow again. */
async function readWorkflowAgain() {
  const reads = sent("workflows.getById").length;
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(
    () => expect(sent("workflows.getById").length).toBeGreaterThan(reads),
    FIND,
  );
  await settle();
}

// What React Flow needs from a browser and jsdom doesn't have. A node with no measured
// size stays hidden, and a hidden element has no role for these tests to find.
class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
class DOMMatrixReadOnlyStub {
  m22 = 1;
}

describe("a workflow page after a save from its edit modal", () => {
  beforeAll(() => {
    global.ResizeObserver = ResizeObserverStub;
    Object.assign(global, { DOMMatrixReadOnly: DOMMatrixReadOnlyStub });
    Object.defineProperties(HTMLElement.prototype, {
      offsetHeight: { configurable: true, get: () => 60 },
      offsetWidth: { configurable: true, get: () => 192 },
    });
  });

  beforeEach(() => {
    mockEvents = new Map(
      [
        storedEvent(NIGHTLY, {
          name: "nightly",
          description: "Before",
          tags: ["old-tag"],
        }),
        storedEvent(WEEKLY, { name: "weekly" }),
        storedEvent(SPARE, { name: "spare", description: "Not on the canvas" }),
      ].map((row) => [row.id as number, row]),
    );
    mockWorkflowNodes = [
      { id: 1, eventId: NIGHTLY },
      { id: 2, eventId: WEEKLY },
    ];
    mockRequests.length = 0;
    mockHeldPaths.clear();
    mockReleaseHeld = [];
    mockFailingPaths.clear();
  });

  afterEach(() => {
    window.location.hash = "";
    focusManager.setFocused(undefined);
  });

  describe.each<[string, Surface]>([
    ["the Overview tab's graph", graph],
    ["a canvas node", canvasNode],
    ["the canvas's sidebar", sidebar],
  ])("%s", (_name, surface) => {
    it("shows the saved name, and the saved details in its popover", async () => {
      const { user } = await openPage(surface.tab);
      await expectPopover(user, surface, "nightly", (popover) => {
        expect(within(popover).getByText("Before")).toBeInTheDocument();
        expect(within(popover).getByText("old-tag")).toBeInTheDocument();
        expect(
          within(popover).getByText(formatDate(STORED_AT)),
        ).toBeInTheDocument();
      });

      await saveFromModal(user, surface, "nightly", async () => {
        await replaceText(user, await nameField(), "renamed");
        await replaceText(user, await descriptionField(), "After");
        await user.type(tagField(), "new-tag{Enter}");
      });

      await surface.find("renamed");
      await expectPopover(user, surface, "renamed", (popover) => {
        const details = within(popover);
        expect(details.getByRole("link", { name: "renamed" })).toBeVisible();
        expect(details.getByText("After")).toBeInTheDocument();
        expect(details.queryByText("Before")).toBeNull();
        expect(details.getByText("old-tag")).toBeInTheDocument();
        expect(details.getByText("new-tag")).toBeInTheDocument();
        expect(details.getByText(formatDate(SAVED_AT))).toBeInTheDocument();
      });
    });

    it("shows new details when the name stays the same", async () => {
      const { user } = await openPage(surface.tab);
      await surface.find("nightly");

      await saveFromModal(user, surface, "nightly", async () => {
        await replaceText(user, await descriptionField(), "After");
      });

      await popoverToSay(user, surface, "nightly", (popover) => {
        expect(within(popover).getByText("After")).toBeInTheDocument();
      });
    });

    it("stops showing a description and tags that were removed", async () => {
      const { user } = await openPage(surface.tab);
      await surface.find("nightly");

      await saveFromModal(user, surface, "nightly", async () => {
        await replaceText(user, await descriptionField(), "");
        await user.type(tagField(), "{Backspace}");
      });

      expect(mockEvents.get(NIGHTLY)).toMatchObject({ tags: [] });
      await popoverToSay(user, surface, "nightly", (popover) => {
        expect(within(popover).queryByText("Before")).toBeNull();
        expect(within(popover).queryByText("old-tag")).toBeNull();
      });
    });
  });

  it("updates every node on the event, and leaves the other nodes alone", async () => {
    mockWorkflowNodes = [
      { id: 1, eventId: NIGHTLY },
      { id: 2, eventId: WEEKLY },
      { id: 3, eventId: NIGHTLY },
    ];
    const { user } = await openPage("overview");
    await graph.find("weekly");

    await saveFromModal(user, graph, "weekly", rename(user, "renamed"));

    await graph.find("renamed");
    expect(screen.getAllByTitle("nightly")).toHaveLength(2);
  });

  it("carries a save from the canvas to the Overview tab, and back", async () => {
    const { user } = await openPage("canvas");
    await saveFromModal(
      user,
      canvasNode,
      "nightly",
      rename(user, "from-canvas"),
    );
    await canvasNode.find("from-canvas");

    await openTab(user, "Overview");
    await graph.find("from-canvas");

    await saveFromModal(user, graph, "from-canvas", rename(user, "from-graph"));
    await graph.find("from-graph");

    await openTab(user, "Canvas");
    await canvasNode.find("from-graph");
    await sidebar.find("from-graph");
  });

  // Coming back from the canvas, a node carries what the canvas reported. A comparison
  // of only the name and type then treated a new description as no change.
  it("shows new details on the Overview tab after the canvas has been opened", async () => {
    const { user } = await openPage("canvas");
    await canvasToSettle();
    await openTab(user, "Overview");
    await graph.find("nightly");

    await saveFromModal(user, graph, "nightly", async () => {
      await replaceText(user, await descriptionField(), "After");
    });

    await popoverToSay(user, graph, "nightly", (popover) => {
      expect(within(popover).getByText("After")).toBeInTheDocument();
    });
  });

  describe("the canvas's own state", () => {
    it("doesn't count as an unsaved change, and doesn't save the workflow", async () => {
      const { user } = await openPage("canvas");
      await canvasToSettle();
      expect(saveButton()).toBeDisabled();

      await saveFromModal(user, canvasNode, "nightly", rename(user, "renamed"));
      await canvasNode.find("renamed");
      await readWorkflowAgain();

      expect(saveButton()).toBeDisabled();
      expect(sent("workflows.update")).toHaveLength(0);
    });

    it("leaves edits that aren't saved yet, still unsaved", async () => {
      const { user } = await openPage("canvas");
      await canvasToSettle();
      await deleteNode(user, "weekly");
      expect(saveButton()).toBeEnabled();

      await saveFromModal(user, canvasNode, "nightly", rename(user, "renamed"));
      await canvasNode.find("renamed");
      await settle();

      expect(canvasNodes()).toHaveLength(1);
      expect(saveButton()).toBeEnabled();
    });

    // The rename changes the event `workflows.getById` nests in each node, so the read
    // after it is a new answer. Taking it used to put back the deleted node everywhere
    // but the canvas, and turn Save off.
    it("keeps edits that aren't saved yet when the workflow is read again", async () => {
      const { user } = await openPage("canvas");
      await canvasToSettle();
      await deleteNode(user, "weekly");

      await saveFromModal(user, canvasNode, "nightly", rename(user, "renamed"));
      await canvasNode.find("renamed");
      await readWorkflowAgain();

      expect(canvasNodes()).toHaveLength(1);
      expect(saveButton()).toBeEnabled();
      await user.click(saveButton());
      await waitFor(
        () => expect(sent("workflows.update")).toHaveLength(1),
        FIND,
      );
      const [saved] = sent("workflows.update") as Array<{
        nodes: Array<{ data: { eventId: number } }>;
        edges: unknown[];
      }>;
      expect(saved!.nodes.map((node) => node.data.eventId)).toEqual([NIGHTLY]);
      expect(saved!.edges).toEqual([]);
    });

    it.each([
      ["Undo", undoButton],
      ["Undo all changes", undoAllButton],
    ])("doesn't bring the old name back with %s", async (_name, button) => {
      const { user } = await openPage("canvas");
      await canvasToSettle();
      await deleteNode(user, "weekly");

      await saveFromModal(user, canvasNode, "nightly", rename(user, "renamed"));
      await canvasNode.find("renamed");

      await user.click(button());

      await canvasNode.find("weekly");
      expect(canvasNodes().map((node) => node.textContent)).toEqual(
        expect.arrayContaining([expect.stringContaining("renamed")]),
      );
      expect(
        canvasNodes().some((node) => node.textContent?.includes("nightly")),
      ).toBe(false);
    });

    it("updates a node dropped on the canvas since the page loaded", async () => {
      const { user } = await openPage("canvas");
      await canvasToSettle();

      const pane = document.querySelector<HTMLElement>(".react-flow")!;
      // jsdom's plain Event, which RTL falls back to, drops the position if it's passed.
      const drop = createEvent.drop(pane, {
        dataTransfer: { getData: () => String(SPARE) },
      });
      Object.assign(drop, { clientX: 400, clientY: 400 });
      fireEvent(pane, drop);
      await canvasNode.find("spare");

      // It's the node's first look at the event's details, not only what was saved.
      await expectPopover(user, canvasNode, "spare", (popover) => {
        expect(
          within(popover).getByText("Not on the canvas"),
        ).toBeInTheDocument();
      });

      await saveFromModal(user, canvasNode, "spare", rename(user, "renamed"));

      await canvasNode.find("renamed");
    });
  });

  describe("reading the list", () => {
    it("reaches an event past the list's limit, because a save moves it to the top", async () => {
      for (let id = 1000; id < 1120; id += 1) {
        mockEvents.set(
          id,
          storedEvent(id, {
            name: `newer ${id}`,
            updatedAt: new Date(STORED_AT.getTime() + id),
          }),
        );
      }
      const { user } = await openPage("overview");
      await graph.find("nightly");
      await waitFor(
        () => expect(sent("events.getAll").length).toBeGreaterThan(0),
        FIND,
      );

      await saveFromModal(user, graph, "nightly", rename(user, "renamed"));

      await graph.find("renamed");
    });

    it("isn't overwritten by a read that left before the save", async () => {
      const { user } = await openPage("overview");
      await graph.find("nightly");
      const reads = sent("events.getAll").length;

      mockHeldPaths.add("events.getAll");
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(
        () => expect(sent("events.getAll")).toHaveLength(reads + 1),
        FIND,
      );

      await saveFromModal(user, graph, "nightly", rename(user, "renamed"));
      await waitFor(
        () => expect(sent("events.getAll")).toHaveLength(reads + 2),
        FIND,
      );
      await letHeldRequestsThrough();

      await graph.find("renamed");
      await settle();
      expect(screen.queryByTitle("nightly")).toBeNull();
    });

    it("keeps working when the read fails, and catches up on the next one", async () => {
      const { user } = await openPage("overview");
      await graph.find("nightly");

      mockFailingPaths.add("events.getAll");
      await saveFromModal(user, graph, "nightly", rename(user, "renamed"));
      await settle();
      await graph.find("nightly");

      mockFailingPaths.clear();
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });

      await graph.find("renamed");
    });
  });

  // What the events list's bulk actions do: one mutation per event, all at once, on a
  // screen rendered by the server, so it has nothing reading the list on the client.
  describe("with nothing on screen reading the list", () => {
    function BulkArchive() {
      const archive = trpc.events.update.useMutation();
      return (
        <button
          onClick={() =>
            void Promise.allSettled(
              [NIGHTLY, WEEKLY, SPARE].map((id) =>
                archive.mutateAsync({ id, status: EventStatus.ARCHIVED }),
              ),
            )
          }
        >
          Archive all
        </button>
      );
    }

    it("sends no list reads for a bulk action, and reads it on coming back", async () => {
      const { user, goTo } = await openPage("overview");
      await graph.find("nightly");

      await goTo(<BulkArchive />);
      const reads = sent("events.getAll").length;

      await user.click(screen.getByRole("button", { name: "Archive all" }));
      await waitFor(() => expect(sent("events.update")).toHaveLength(3), FIND);
      await settle();

      expect(sent("events.getAll")).toHaveLength(reads);

      await goTo(workflowPage);

      await waitFor(
        () => expect(sent("events.getAll")).toHaveLength(reads + 1),
        FIND,
      );
    });
  });
});
