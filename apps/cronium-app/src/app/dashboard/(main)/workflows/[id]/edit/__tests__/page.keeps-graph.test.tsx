/**
 * Save Workflow on the edit page emptied the workflow and said it worked. The form
 * copies the graph once, as it mounts, and that was before the page had read it, so the
 * canvas opened empty and the save sent `nodes: []` and `edges: []`. The server takes
 * those as an instruction, and deleted every node and connection.
 *
 * Only the network is fake. The page, the form and the canvas on real React Flow run
 * over `TrpcProvider`'s real QueryClient, with answers from the real DTOs over rows in
 * memory. `workflows.update` handles a graph the way the real one does, replacing every
 * node and connection with new ones, so these tests read what's stored, not what's sent.
 * The new workflow page uses the same form, so it's here too.
 *
 * The Details tab had two bugs of its own. Every read of the workflow, which React Query
 * makes whenever the window comes back, reset the form to what's stored, so a save wrote
 * back the stored name over a typed one and said it worked. And the Status and Trigger
 * Type lists showed the form's starting values, Draft and Manual, while the form held
 * and saved the workflow's own.
 */
import React from "react";
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
import { useQueryClient } from "@tanstack/react-query";

interface Request {
  path: string;
  input: Record<string, unknown>;
}

type Row = Record<string, unknown>;

interface StoredNode {
  id: number;
  eventId: number;
  position_x: number;
  position_y: number;
}

interface StoredConnection {
  id: number;
  sourceNodeId: number;
  targetNodeId: number;
  connectionType: string;
}

interface SentNode {
  id: string;
  position: { x: number; y: number };
  data: { eventId: number };
}

interface SentEdge {
  source: string;
  target: string;
  data: { connectionType: string };
}

let mockEvents: Map<number, Row>;
let mockWorkflow: Row;
let mockNodes: StoredNode[];
let mockConnections: StoredConnection[];
let mockNextId: number;
const mockRequests: Request[] = [];
const mockToasts: Array<{ title?: string; variant?: string }> = [];

// Stands in for AES: storage hands the API ciphertext, and only the DTO decrypts.
jest.mock("@/lib/security/field-secret", () => ({
  decryptEnvVarValue: (stored: string) => stored.replace(/^ciphertext:/, ""),
}));

async function mockAnswer(request: Request): Promise<unknown> {
  mockRequests.push(request);
  return asSent(mockServerAnswer(request));
}

/**
 * An answer as the page gets it. superjson makes new Dates for every answer, and React
 * Query's structural sharing keeps the last answer only where everything is the same
 * object, so every read of the workflow is a new object even when nothing changed.
 */
function asSent<T>(value: T): T {
  if (value instanceof Date) return new Date(value) as T;
  if (Array.isArray(value)) return value.map(asSent) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, asSent(item)]),
    ) as T;
  }
  return value;
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
  usePathname: () => "/dashboard/workflows/9/edit",
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}));

// next/dynamic would load it a tick later, for no benefit here.
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

// What the page says happened, which is gone from the screen in seconds.
jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<typeof import("@cronium/ui")>("@cronium/ui"),
  toast: (said: { title?: string; variant?: string }) => {
    mockToasts.push(said);
    return {
      id: String(mockToasts.length),
      dismiss: () => {},
      update: () => {},
    };
  },
}));

import EditWorkflowPage from "../page";
import NewWorkflowPage from "../../../new/page";
import { TrpcProvider } from "@/components/providers/TrpcProvider";
import { formatDate } from "@/lib/utils";
import { toEventListApiDto, toWorkflowApiDto } from "@/server/security/api-dto";
import {
  ConnectionType,
  EventStatus,
  EventTriggerType,
  EventType,
  RunLocation,
  TimeUnit,
  WorkflowTriggerType,
} from "@/shared/schema";

// Each test renders the whole form and a canvas, and CI runs with coverage.
jest.setTimeout(120_000);

const OWNER = "owner";
const WORKFLOW_ID = 9;
const NIGHTLY = 42;
const WEEKLY = 43;
const SPARE = 44;
const FIND = { timeout: 60_000 };
const CREATED_AT = new Date("2026-01-02T03:04:05.000Z");
const STORED_AT = new Date("2026-02-03T04:05:06.000Z");

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

function storedWorkflow(id: number, fields: Row): Row {
  return {
    id,
    userId: OWNER,
    name: "Deploy",
    description: null,
    triggerType: WorkflowTriggerType.MANUAL,
    runLocation: RunLocation.LOCAL,
    status: EventStatus.ACTIVE,
    scheduleNumber: null,
    scheduleUnit: null,
    customSchedule: null,
    tags: [],
    shared: false,
    webhookKey: null,
    webhookKeyHash: null,
    overrideEventServers: false,
    overrideServerIds: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...fields,
  };
}

/** The real one orders by `updated_at`, newest first, and stops at the limit. */
function eventList({ limit, offset }: Record<string, unknown>) {
  const rows = [...mockEvents.values()].sort(
    (a, b) => (b.id as number) - (a.id as number),
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
      ...mockWorkflow,
      nodes: mockNodes.map((node) => ({
        ...node,
        workflowId: mockWorkflow.id,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        event: mockEvents.get(node.eventId),
      })),
      connections: mockConnections.map((connection) => ({
        ...connection,
        workflowId: mockWorkflow.id,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      })),
    } as never,
    OWNER,
  );
}

/** As `workflows.update` and `create` do: every node and connection a new row. */
function replaceGraph(nodes: SentNode[], edges: SentEdge[]) {
  const stored = new Map<string, number>();
  mockNodes = nodes.map((node) => {
    const id = mockNextId++;
    stored.set(node.id, id);
    return {
      id,
      eventId: node.data.eventId,
      position_x: node.position.x,
      position_y: node.position.y,
    };
  });
  mockConnections = edges.flatMap((edge) => {
    const sourceNodeId = stored.get(edge.source);
    const targetNodeId = stored.get(edge.target);
    return sourceNodeId === undefined || targetNodeId === undefined
      ? []
      : [
          {
            id: mockNextId++,
            sourceNodeId,
            targetNodeId,
            connectionType: edge.data.connectionType,
          },
        ];
  });
}

function mockServerAnswer({ path, input }: Request): unknown {
  switch (path) {
    case "events.getAll":
      return eventList(input);
    case "servers.getAll":
      return { servers: [] };
    case "workflows.getById":
      return { data: workflowDto() };
    case "workflows.update": {
      const { id: _id, nodes, edges, webhookKey: _key, ...fields } = input;
      Object.assign(
        mockWorkflow,
        Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value != null),
        ),
      );
      // Edges travel with nodes, and the schema refuses one without the other.
      if (nodes !== undefined) {
        replaceGraph(nodes as SentNode[], edges as SentEdge[]);
      }
      return workflowDto();
    }
    case "workflows.create": {
      const { nodes, edges, ...fields } = input;
      mockWorkflow = storedWorkflow(WORKFLOW_ID + 1, fields);
      replaceGraph(nodes as SentNode[], edges as SentEdge[]);
      return { data: workflowDto() };
    }
    default:
      throw new Error(`Nothing answers ${path} in this test`);
  }
}

function sent(path: string): Array<Record<string, unknown>> {
  return mockRequests
    .filter((request) => request.path === path)
    .map((request) => request.input);
}

/** The stored graph by event and place, since a save that sends one renumbers it. */
function storedGraph() {
  const eventOf = new Map(mockNodes.map((node) => [node.id, node.eventId]));
  return {
    nodes: mockNodes.map(({ eventId, position_x, position_y }) => ({
      eventId,
      x: position_x,
      y: position_y,
    })),
    connections: mockConnections.map((connection) => ({
      from: eventOf.get(connection.sourceNodeId),
      to: eventOf.get(connection.targetNodeId),
      type: connection.connectionType,
    })),
  };
}

const STORED_GRAPH = {
  nodes: [
    { eventId: NIGHTLY, x: 120, y: 90 },
    { eventId: WEEKLY, x: 420, y: 90 },
  ],
  connections: [{ from: NIGHTLY, to: WEEKLY, type: ConnectionType.ON_SUCCESS }],
};

/** A failure would otherwise spend 7 seconds on react-query's retries. */
function WithoutRetries() {
  useQueryClient().setDefaultOptions({ queries: { retry: false } });
  return null;
}

async function openPage(page: React.ReactElement = <EditWorkflowPage />) {
  await act(async () =>
    render(
      <TrpcProvider>
        <WithoutRetries />
        {page}
      </TrpcProvider>,
    ),
  );
  return userEvent.setup();
}

const nameField = () => screen.findByLabelText("Name", undefined, FIND);

/** Waits for the stored name, which is there once the page has the workflow. */
async function typeName(user: UserEvent, typed: string) {
  const name = await nameField();
  await waitFor(() => expect(name).toHaveValue("Deploy"), FIND);
  await user.clear(name);
  await user.type(name, typed);
}

type ListName = "Status" | "Trigger Type";

/** A Radix Select's button, which shows the option chosen. */
const list = (name: ListName) => screen.getByRole("combobox", { name });

async function choose(user: UserEvent, name: ListName, option: RegExp) {
  await user.click(list(name));
  await user.click(await screen.findByRole("option", { name: option }, FIND));
}

/** As coming back to the window does: the page reads the workflow again. */
async function refocus() {
  const reads = sent("workflows.getById").length;
  await act(async () => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(
    () => expect(sent("workflows.getById").length).toBeGreaterThan(reads),
    FIND,
  );
  await settle();
}

/** Enabled once the events list is in, which the canvas needs. */
async function submitButton(name: string) {
  const button = await screen.findByRole("button", { name }, FIND);
  await waitFor(() => expect(button).toBeEnabled(), FIND);
  return button;
}

const saveButton = () => submitButton("Save Workflow");

const openTab = async (user: UserEvent, name: "Details" | "Workflow") =>
  user.click(await screen.findByRole("tab", { name }, FIND));

const canvasNodes = () => [
  ...document.querySelectorAll<HTMLElement>(".react-flow__node"),
];

const canvasNode = (name: string) =>
  waitFor(() => {
    const node = canvasNodes().find((n) => n.textContent?.includes(name));
    expect(node).toBeDefined();
    return node!;
  }, FIND);

/** The canvas ignores edits for its first moments, and enables this when it's done. */
const canvasToSettle = () =>
  waitFor(
    () =>
      expect(
        screen.getByRole("button", { name: "Undo all changes" }),
      ).toBeEnabled(),
    FIND,
  );

/**
 * On a node this can't be `user.click`: React Flow's drag handler sees every press there
 * and reads the document from the event's `view`, which user-event leaves empty.
 */
const clickOnCanvas = (element: HTMLElement) => fireEvent.click(element);

/** Long enough for a late request or answer to have landed. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

/** Saves, and waits for the page to have heard back. */
async function save(user: UserEvent) {
  const saves = sent("workflows.update").length;
  await user.click(await saveButton());
  await waitFor(
    () => expect(sent("workflows.update")).toHaveLength(saves + 1),
    FIND,
  );
  await waitFor(
    () =>
      expect(mockRouter.push).toHaveBeenCalledWith(
        `/dashboard/workflows/${WORKFLOW_ID}`,
      ),
    FIND,
  );
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

beforeAll(() => {
  global.ResizeObserver = ResizeObserverStub;
  Object.assign(global, { DOMMatrixReadOnly: DOMMatrixReadOnlyStub });
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get: () => 60 },
    offsetWidth: { configurable: true, get: () => 192 },
  });
  // And what Radix Select asks of one, for the Details tab's lists.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  mockEvents = new Map(
    [
      storedEvent(NIGHTLY, {
        name: "nightly",
        description: "Runs at night",
        tags: ["ops"],
      }),
      storedEvent(WEEKLY, { name: "weekly" }),
      storedEvent(SPARE, { name: "spare" }),
    ].map((row) => [row.id as number, row]),
  );
  mockWorkflow = storedWorkflow(WORKFLOW_ID, {});
  mockNodes = [
    { id: 1, eventId: NIGHTLY, position_x: 120, position_y: 90 },
    { id: 2, eventId: WEEKLY, position_x: 420, position_y: 90 },
  ];
  mockConnections = [
    {
      id: 1,
      sourceNodeId: 1,
      targetNodeId: 2,
      connectionType: ConnectionType.ON_SUCCESS,
    },
  ];
  mockNextId = 100;
  mockRequests.length = 0;
  mockToasts.length = 0;
  mockRouter.push.mockClear();
});

describe("the workflow edit page", () => {
  it("opens the canvas on the workflow's nodes and connection, drawn as events", async () => {
    const user = await openPage();
    await openTab(user, "Workflow");

    await canvasNode("nightly");
    await canvasNode("weekly");
    expect(canvasNodes()).toHaveLength(2);
    // Not React Flow's fallback for a type it doesn't know.
    for (const node of canvasNodes()) {
      expect(node).toHaveClass("react-flow__node-eventNode");
    }
    await waitFor(
      () =>
        expect(document.querySelectorAll(".react-flow__edge")).toHaveLength(1),
      FIND,
    );
  });

  it("shows a node's event details", async () => {
    const user = await openPage();
    await openTab(user, "Workflow");

    clickOnCanvas(within(await canvasNode("nightly")).getByRole("button"));

    const popover = await screen.findByRole("dialog", undefined, FIND);
    expect(within(popover).getByText("Runs at night")).toBeInTheDocument();
    expect(within(popover).getByText("ops")).toBeInTheDocument();
    expect(
      within(popover).getByText(formatDate(STORED_AT)),
    ).toBeInTheDocument();
  });

  describe("Save Workflow", () => {
    it("keeps the nodes and connection when only the details were edited", async () => {
      const user = await openPage();
      const name = await nameField();
      await waitFor(() => expect(name).toHaveValue("Deploy"), FIND);
      await user.clear(name);
      await user.type(name, "Deploy nightly");

      await save(user);

      expect(mockWorkflow.name).toBe("Deploy nightly");
      expect(storedGraph()).toEqual(STORED_GRAPH);
      // Not replaced either: a running workflow finds its steps by node id.
      expect(mockNodes.map((node) => node.id)).toEqual([1, 2]);
      expect(mockToasts).toContainEqual(
        expect.objectContaining({ variant: "success" }),
      );
    });

    it("keeps them once the canvas has been opened", async () => {
      const user = await openPage();
      await openTab(user, "Workflow");
      await canvasNode("weekly");
      await canvasToSettle();

      await save(user);

      expect(storedGraph()).toEqual(STORED_GRAPH);
      expect(mockNodes.map((node) => node.id)).toEqual([1, 2]);
    });

    it("keeps them when the canvas is opened and left again", async () => {
      const user = await openPage();
      await openTab(user, "Workflow");
      await canvasToSettle();
      await openTab(user, "Details");

      await save(user);

      expect(storedGraph()).toEqual(STORED_GRAPH);
    });

    it("leaves a graph that was changed somewhere else since the page loaded", async () => {
      const user = await openPage();
      await waitFor(async () =>
        expect(await nameField()).toHaveValue("Deploy"),
      );
      mockNodes.push({
        id: 3,
        eventId: SPARE,
        position_x: 720,
        position_y: 90,
      });
      mockConnections.push({
        id: 2,
        sourceNodeId: 2,
        targetNodeId: 3,
        connectionType: ConnectionType.ALWAYS,
      });
      const changed = storedGraph();

      await save(user);

      expect(storedGraph()).toEqual(changed);
    });

    it("saves a node deleted on the canvas, with its connection", async () => {
      const user = await openPage();
      await openTab(user, "Workflow");
      clickOnCanvas(await canvasNode("weekly"));
      await canvasToSettle();
      const remove = screen.getByRole("button", { name: "Delete selected" });
      await waitFor(() => expect(remove).toBeEnabled(), FIND);

      await user.click(remove);
      await waitFor(() => expect(canvasNodes()).toHaveLength(1), FIND);
      await settle();
      // The canvas's own buttons are for the canvas.
      expect(sent("workflows.update")).toHaveLength(0);

      await save(user);

      expect(storedGraph()).toEqual({
        nodes: [{ eventId: NIGHTLY, x: 120, y: 90 }],
        connections: [],
      });
    });
  });

  // Each of these was a submit button inside the form, so pressing one saved the workflow.
  describe.each([
    ["the events list's Hide button", "Hide events list"],
    ["Undo all changes", "Undo all changes"],
  ])("pressing %s on the canvas", (_name, label) => {
    it("doesn't save the workflow", async () => {
      const user = await openPage();
      await openTab(user, "Workflow");
      await canvasNode("weekly");
      await canvasToSettle();

      await user.click(screen.getByRole("button", { name: label }));
      await settle();

      expect(sent("workflows.update")).toHaveLength(0);
      expect(storedGraph()).toEqual(STORED_GRAPH);
    });
  });

  describe("the Details tab", () => {
    it("shows the workflow's status and trigger type", async () => {
      mockWorkflow = storedWorkflow(WORKFLOW_ID, {
        status: EventStatus.PAUSED,
        triggerType: WorkflowTriggerType.WEBHOOK,
      });
      await openPage();
      await waitFor(
        async () => expect(await nameField()).toHaveValue("Deploy"),
        FIND,
      );

      expect(list("Status")).toHaveTextContent("Paused");
      expect(list("Trigger Type")).toHaveTextContent(/^Webhook/);
    });
  });

  // React Query reads the workflow again whenever the window comes back.
  describe("reading the workflow again while the page is open", () => {
    it.each([
      ["nothing has changed", () => {}],
      [
        "an event on it was renamed",
        () => {
          mockEvents.get(NIGHTLY)!.name = "nightly backup";
        },
      ],
    ])("keeps a typed name when %s", async (_change, change) => {
      const user = await openPage();
      await typeName(user, "Deploy nightly");

      change();
      await refocus();

      expect(await nameField()).toHaveValue("Deploy nightly");
      await save(user);
      expect(mockWorkflow.name).toBe("Deploy nightly");
    });

    it("keeps what was chosen in the lists", async () => {
      const user = await openPage();
      await waitFor(
        async () => expect(await nameField()).toHaveValue("Deploy"),
        FIND,
      );
      await choose(user, "Status", /^Paused/);
      await choose(user, "Trigger Type", /^Webhook/);

      mockWorkflow.description = "Ships the build";
      await refocus();

      expect(list("Status")).toHaveTextContent("Paused");
      expect(list("Trigger Type")).toHaveTextContent(/^Webhook/);
      await save(user);
      expect(mockWorkflow).toMatchObject({
        status: EventStatus.PAUSED,
        triggerType: WorkflowTriggerType.WEBHOOK,
      });
    });

    // A save sends every field, so one still holding the old value would put it back.
    it("takes a change made elsewhere into the fields nobody has edited", async () => {
      const user = await openPage();
      await typeName(user, "Deploy nightly");

      // Paused from the workflows list, say, while this page was open.
      Object.assign(mockWorkflow, {
        status: EventStatus.PAUSED,
        triggerType: WorkflowTriggerType.WEBHOOK,
        description: "Ships the build",
      });
      await refocus();

      expect(await nameField()).toHaveValue("Deploy nightly");
      expect(screen.getByLabelText("Description")).toHaveValue(
        "Ships the build",
      );
      expect(list("Status")).toHaveTextContent("Paused");
      expect(list("Trigger Type")).toHaveTextContent(/^Webhook/);
      await save(user);
      expect(mockWorkflow).toMatchObject({
        name: "Deploy nightly",
        description: "Ships the build",
        status: EventStatus.PAUSED,
        triggerType: WorkflowTriggerType.WEBHOOK,
      });
    });

    // The canvas keeps the graph it opened on, so a save mustn't take the difference
    // between that and what's stored now for an edit, and replace the graph.
    it("leaves a graph changed elsewhere, which the canvas doesn't show", async () => {
      const user = await openPage();
      await typeName(user, "Deploy nightly");
      mockNodes.push({
        id: 3,
        eventId: SPARE,
        position_x: 720,
        position_y: 90,
      });
      mockConnections.push({
        id: 2,
        sourceNodeId: 2,
        targetNodeId: 3,
        connectionType: ConnectionType.ALWAYS,
      });
      const changed = storedGraph();

      await refocus();
      await save(user);

      expect(mockWorkflow.name).toBe("Deploy nightly");
      expect(storedGraph()).toEqual(changed);
      expect(mockNodes.map((node) => node.id)).toEqual([1, 2, 3]);
    });

    it("keeps the canvas's changes", async () => {
      const user = await openPage();
      await openTab(user, "Workflow");
      clickOnCanvas(await canvasNode("weekly"));
      await canvasToSettle();
      const remove = screen.getByRole("button", { name: "Delete selected" });
      await waitFor(() => expect(remove).toBeEnabled(), FIND);
      await user.click(remove);
      await waitFor(() => expect(canvasNodes()).toHaveLength(1), FIND);

      await refocus();
      await openTab(user, "Details");
      await typeName(user, "Deploy nightly");
      await save(user);

      expect(mockWorkflow.name).toBe("Deploy nightly");
      expect(storedGraph()).toEqual({
        nodes: [{ eventId: NIGHTLY, x: 120, y: 90 }],
        connections: [],
      });
    });
  });
});

// The same form, starting from nothing.
describe("the new workflow page", () => {
  // A click on one handle and then another joins them, and jsdom has neither of these.
  // With nothing under the pointer, React Flow joins to the handle that was clicked.
  beforeAll(() => {
    document.elementFromPoint = () => null;
    global.structuredClone = <T,>(value: T): T =>
      JSON.parse(JSON.stringify(value)) as T;
  });

  afterAll(() => {
    Reflect.deleteProperty(document, "elementFromPoint");
    Reflect.deleteProperty(global, "structuredClone");
  });

  async function openNewPage() {
    const user = await openPage(<NewWorkflowPage />);
    await user.type(await nameField(), "Nightly deploy");
    await openTab(user, "Workflow");
    await screen.findByText("Available Events", undefined, FIND);
    return user;
  }

  function dropEvent(eventId: number, x: number) {
    const pane = document.querySelector<HTMLElement>(".react-flow")!;
    // jsdom's plain Event, which RTL falls back to, drops the position if it's passed.
    const drop = createEvent.drop(pane, {
      dataTransfer: { getData: () => String(eventId) },
    });
    Object.assign(drop, { clientX: x, clientY: 300 });
    fireEvent(pane, drop);
  }

  const handle = (node: HTMLElement, type: "source" | "target") =>
    node.querySelector<HTMLElement>(`.react-flow__handle.${type}`)!;

  it("creates the workflow with the events placed and joined on its canvas", async () => {
    const user = await openNewPage();
    await settle();
    dropEvent(NIGHTLY, 200);
    const nightly = await canvasNode("nightly");
    dropEvent(WEEKLY, 500);
    const weekly = await canvasNode("weekly");

    clickOnCanvas(handle(nightly, "source"));
    clickOnCanvas(handle(weekly, "target"));
    await waitFor(
      () =>
        expect(document.querySelectorAll(".react-flow__edge")).toHaveLength(1),
      FIND,
    );

    await user.click(await submitButton("Create Workflow"));
    await waitFor(() => expect(sent("workflows.create")).toHaveLength(1), FIND);

    expect(mockWorkflow.name).toBe("Nightly deploy");
    expect(storedGraph().nodes.map((node) => node.eventId)).toEqual([
      NIGHTLY,
      WEEKLY,
    ]);
    expect(storedGraph().connections).toEqual([
      { from: NIGHTLY, to: WEEKLY, type: ConnectionType.ALWAYS },
    ]);
  });

  it("doesn't create the workflow when a canvas button is pressed", async () => {
    const user = await openNewPage();

    await user.click(screen.getByRole("button", { name: "Hide events list" }));
    await settle();

    expect(sent("workflows.create")).toHaveLength(0);
  });

  it("starts as a manual draft and creates the workflow with the status and trigger chosen", async () => {
    const user = await openPage(<NewWorkflowPage />);
    await user.type(await nameField(), "Nightly deploy");
    expect(list("Status")).toHaveTextContent("Draft");
    expect(list("Trigger Type")).toHaveTextContent(/^Manual/);

    // Not Active, which the server refuses for a workflow with no nodes.
    await choose(user, "Status", /^Paused/);
    await choose(user, "Trigger Type", /^Webhook/);
    expect(list("Status")).toHaveTextContent("Paused");
    expect(list("Trigger Type")).toHaveTextContent(/^Webhook/);
    await user.click(await submitButton("Create Workflow"));
    await waitFor(() => expect(sent("workflows.create")).toHaveLength(1), FIND);

    expect(mockWorkflow).toMatchObject({
      name: "Nightly deploy",
      status: EventStatus.PAUSED,
      triggerType: WorkflowTriggerType.WEBHOOK,
    });
  });
});
