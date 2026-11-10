/**
 * The Save button on a workflow's Canvas tab: it's on when what the canvas shows differs
 * from what's saved, and it saves what the canvas shows.
 *
 * Only the network is fake here. The page and the canvas run on real React Flow over
 * `TrpcProvider`'s real QueryClient. The server's side keeps the graph in memory and, like
 * the real one, makes every node again with a new id on each save. Each read builds new
 * `Date`s, as superjson does, so React Query hands the page a new answer on every read.
 */
import React, { Suspense } from "react";
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { focusManager, useQueryClient } from "@tanstack/react-query";

interface Request {
  path: string;
  input: Record<string, unknown>;
}

type Row = Record<string, unknown>;

interface StoredNode {
  id: number;
  eventId: number;
  x: number;
  y: number;
}

interface StoredConnection {
  id: number;
  source: number;
  target: number;
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
let mockNodes: StoredNode[];
let mockConnections: StoredConnection[];
let mockNextId: number;
const mockRequests: Request[] = [];

// Stands in for AES: storage hands the API ciphertext, and only the DTO decrypts.
jest.mock("@/lib/security/field-secret", () => ({
  decryptEnvVarValue: (stored: string) => stored.replace(/^ciphertext:/, ""),
}));

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
              const request = {
                path: op.path,
                input: op.input as Record<string, unknown>,
              };
              mockRequests.push(request);
              try {
                observer.next({
                  result: { type: "data", data: mockServerAnswer(request) },
                });
                observer.complete();
              } catch (cause) {
                observer.error(TRPCClientError.from(cause as Error));
              }
            }),
      ],
    }),
  };
});

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "9" }),
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/dashboard/workflows/9",
}));

// next/dynamic would load it a tick later, for no benefit here.
jest.mock("@/components/workflows/WorkflowCanvas-lazy", () => ({
  __esModule: true,
  default: jest.requireActual<
    typeof import("@/components/workflows/WorkflowCanvas")
  >("@/components/workflows/WorkflowCanvas").default,
}));

jest.mock("@xyflow/react", () => {
  const actual =
    jest.requireActual<typeof import("@xyflow/react")>("@xyflow/react");
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  type Props = React.ComponentProps<typeof actual.ReactFlow>;
  return {
    ...actual,
    // A backdrop and a minimap, whose sums come out as NaN in jsdom and fill the log.
    Background: () => null,
    MiniMap: () => null,
    // Fitting the view to the nodes is a d3-zoom transition that comes out as NaN in
    // jsdom, and every node dropped or dragged there would land at NaN. The view stays
    // where it starts instead, at 1:1.
    ReactFlow: (props: Props) =>
      ReactActual.createElement(actual.ReactFlow, {
        ...props,
        onInit: (instance: Parameters<NonNullable<Props["onInit"]>>[0]) =>
          props.onInit?.({ ...instance, fitView: () => Promise.resolve(true) }),
      }),
  };
});

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

// Each test drives real React Flow, and CI runs with coverage.
jest.setTimeout(120_000);

const OWNER = "owner";
const WORKFLOW_ID = 9;
const NIGHTLY = 42;
const WEEKLY = 43;
const SPARE = 44;
const FIND = { timeout: 60_000 };
const CREATED_AT = new Date("2026-01-02T03:04:05.000Z");

function storedEvent(id: number, name: string): Row {
  return {
    id,
    userId: OWNER,
    name,
    description: null,
    shared: false,
    type: EventType.BASH,
    content: "true",
    status: EventStatus.ACTIVE,
    triggerType: EventTriggerType.MANUAL,
    scheduleNumber: 1,
    scheduleUnit: TimeUnit.MINUTES,
    customSchedule: null,
    timezone: "UTC",
    runLocation: RunLocation.LOCAL,
    serverId: null,
    tags: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    servers: [],
    envVars: [],
  };
}

function eventList() {
  const rows = [...mockEvents.values()];
  return {
    events: rows.map((row) =>
      toEventListApiDto({ ...row, eventServers: [] } as never, OWNER),
    ),
    total: rows.length,
    hasMore: false,
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
      // New on each read, as superjson's are.
      createdAt: new Date(CREATED_AT),
      updatedAt: new Date(CREATED_AT),
      nodes: mockNodes.map(({ id, eventId, x, y }) => ({
        id,
        workflowId: WORKFLOW_ID,
        eventId,
        position_x: x,
        position_y: y,
        event: mockEvents.get(eventId),
      })),
      connections: mockConnections.map(
        ({ id, source, target, connectionType }) => ({
          id,
          workflowId: WORKFLOW_ID,
          sourceNodeId: source,
          targetNodeId: target,
          connectionType,
        }),
      ),
    } as never,
    OWNER,
  );
}

/** What the real `workflows.update` does with a graph: makes every node again. */
function saveGraph(nodes: SentNode[], edges: SentEdge[]) {
  for (const { position } of nodes) {
    // The columns are integers, and Postgres refuses anything else.
    if (!Number.isInteger(position.x) || !Number.isInteger(position.y)) {
      throw new Error(`invalid input syntax for type integer: ${position.x}`);
    }
  }
  const ids = new Map<string, number>();
  mockNodes = nodes.map((node) => {
    const id = mockNextId++;
    ids.set(node.id, id);
    return {
      id,
      eventId: node.data.eventId,
      x: node.position.x,
      y: node.position.y,
    };
  });
  mockConnections = edges.flatMap((edge) => {
    const source = ids.get(edge.source);
    const target = ids.get(edge.target);
    return source !== undefined && target !== undefined
      ? [
          {
            id: mockNextId++,
            source,
            target,
            connectionType: edge.data.connectionType,
          },
        ]
      : [];
  });
}

function mockServerAnswer({ path, input }: Request): unknown {
  switch (path) {
    case "events.getAll":
      return eventList();
    case "workflows.getById":
      return { data: workflowDto() };
    case "workflows.getExecutions":
      return { executions: { executions: [], total: 0 }, hasMore: false };
    case "workflows.update":
      if (input.nodes) {
        saveGraph(input.nodes as SentNode[], input.edges as SentEdge[]);
      }
      return workflowDto();
    default:
      throw new Error(`Nothing answers ${path} in this test`);
  }
}

function sent(path: string): Array<Record<string, unknown>> {
  return mockRequests
    .filter((request) => request.path === path)
    .map((request) => request.input);
}

/** The graph a save sent, as event and position, in the order it was sent. */
function lastSavedGraph() {
  const saves = sent("workflows.update");
  const { nodes, edges } = saves[saves.length - 1] as {
    nodes: SentNode[];
    edges: SentEdge[];
  };
  const eventOf = new Map(nodes.map((node) => [node.id, node.data.eventId]));
  return {
    nodes: nodes.map(({ position, data }) => ({
      eventId: data.eventId,
      ...position,
    })),
    edges: edges.map((edge) => [
      eventOf.get(edge.source),
      eventOf.get(edge.target),
    ]),
  };
}

/** What the server has, in the same terms. */
function storedGraph() {
  const eventOf = new Map(mockNodes.map((node) => [node.id, node.eventId]));
  return {
    nodes: mockNodes.map(({ eventId, x, y }) => ({ eventId, x, y })),
    edges: mockConnections.map(({ source, target }) => [
      eventOf.get(source),
      eventOf.get(target),
    ]),
  };
}

/** A failure would otherwise spend 7 seconds on react-query's retries. */
function WithoutRetries() {
  useQueryClient().setDefaultOptions({ queries: { retry: false } });
  return null;
}

const params = Promise.resolve({ id: String(WORKFLOW_ID) });

/** A new QueryClient each time, so a render is a fresh load of the page. */
function App() {
  return (
    <TrpcProvider>
      <WithoutRetries />
      <Suspense fallback={null}>
        <WorkflowDetailsPage params={params} />
      </Suspense>
    </TrpcProvider>
  );
}

async function openCanvas() {
  window.location.hash = "#canvas";
  const view = await act(async () => render(<App />));
  return {
    user: userEvent.setup(),
    /** What a reload of the page shows. */
    reload: async () => {
      view.unmount();
      await act(async () => {
        render(<App />);
      });
    },
  };
}

const canvasNodes = () => [
  ...document.querySelectorAll<HTMLElement>(".react-flow__node"),
];

const nodesNamed = (name: string) =>
  canvasNodes().filter((node) => node.textContent?.includes(name));

const findNode = (name: string) =>
  waitFor(() => {
    const [node] = nodesNamed(name);
    expect(node).toBeDefined();
    return node!;
  }, FIND);

/** Where the canvas draws a node, from the transform React Flow gives it. */
function shownPosition(node: HTMLElement) {
  const match = /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(
    node.style.transform,
  );
  expect(match).not.toBeNull();
  return { x: Number(match![1]), y: Number(match![2]) };
}

const saveButton = () => screen.getByRole("button", { name: "Save" });
const undoButton = () => screen.getByRole("button", { name: "Undo" });
const undoAllButton = () =>
  screen.getByRole("button", { name: "Undo all changes" });

/** The canvas ignores edits for its first moments, and enables this when it's done. */
const canvasToSettle = () =>
  waitFor(() => expect(undoAllButton()).toBeEnabled(), FIND);

/** Long enough for anything still on its way to have landed. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

/**
 * On a node this can't be `user.click`: React Flow's drag handler sees every press there
 * and reads the document from the event's `view`, which user-event leaves empty.
 */
const clickOnCanvas = (element: HTMLElement) => fireEvent.click(element);

async function deleteNode(user: UserEvent, name: string) {
  const before = nodesNamed(name).length;
  clickOnCanvas(await findNode(name));
  const remove = screen.getByRole("button", { name: "Delete selected" });
  await waitFor(() => expect(remove).toBeEnabled(), FIND);
  await user.click(remove);
  await waitFor(() => expect(nodesNamed(name)).toHaveLength(before - 1), FIND);
}

async function dropOnCanvas(eventId: number, name: string) {
  const before = nodesNamed(name).length;
  const pane = document.querySelector<HTMLElement>(".react-flow")!;
  // jsdom's plain Event, which RTL falls back to, drops the position if it's passed.
  const drop = createEvent.drop(pane, {
    dataTransfer: { getData: () => String(eventId) },
  });
  Object.assign(drop, { clientX: 400, clientY: 400 });
  fireEvent(pane, drop);
  await waitFor(() => expect(nodesNamed(name)).toHaveLength(before + 1), FIND);
}

/** A press, a move past React Flow's threshold and a release, as d3-drag reads them. */
async function dragNode(name: string, by: { x: number; y: number }) {
  const node = await findNode(name);
  const from = shownPosition(node);
  const at = { clientX: 50, clientY: 50, view: window };
  fireEvent.mouseDown(node, { ...at, button: 0 });
  for (const step of [0.5, 1]) {
    fireEvent.mouseMove(window, {
      ...at,
      clientX: at.clientX + by.x * step,
      clientY: at.clientY + by.y * step,
    });
  }
  fireEvent.mouseUp(window, {
    ...at,
    clientX: at.clientX + by.x,
    clientY: at.clientY + by.y,
  });
  await waitFor(() => expect(shownPosition(node)).not.toEqual(from), FIND);
  return shownPosition(node);
}

async function save(user: UserEvent) {
  const saves = sent("workflows.update").length;
  await user.click(saveButton());
  await waitFor(
    () => expect(sent("workflows.update")).toHaveLength(saves + 1),
    FIND,
  );
  await settle();
}

/** Leave the window and come back, which reads the workflow again. */
async function refocus() {
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
// size stays hidden, and a hidden element has no role for these tests to find. The
// canvas's fit to its nodes is a d3-zoom transition sized by `clientWidth`, and at
// jsdom's 0 it leaves the view at NaN, and every dropped or dragged node with it.
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

describe("the Save button on a workflow's canvas", () => {
  beforeAll(() => {
    global.ResizeObserver = ResizeObserverStub;
    Object.assign(global, { DOMMatrixReadOnly: DOMMatrixReadOnlyStub });
    Object.defineProperties(HTMLElement.prototype, {
      offsetHeight: { configurable: true, get: () => 60 },
      offsetWidth: { configurable: true, get: () => 192 },
    });
    Object.defineProperties(Element.prototype, {
      clientHeight: { configurable: true, get: () => 600 },
      clientWidth: { configurable: true, get: () => 800 },
    });
  });

  beforeEach(() => {
    mockEvents = new Map(
      [
        storedEvent(NIGHTLY, "nightly"),
        storedEvent(WEEKLY, "weekly"),
        storedEvent(SPARE, "spare"),
      ].map((row) => [row.id as number, row]),
    );
    mockNodes = [
      { id: 1, eventId: NIGHTLY, x: 300, y: 105 },
      { id: 2, eventId: WEEKLY, x: 600, y: 105 },
    ];
    mockConnections = [
      {
        id: 1,
        source: 1,
        target: 2,
        connectionType: ConnectionType.ON_SUCCESS,
      },
    ];
    mockNextId = 100;
    mockRequests.length = 0;
  });

  afterEach(() => {
    window.location.hash = "";
    focusManager.setFocused(undefined);
  });

  it("is off when the canvas opens, and when the workflow is read again", async () => {
    await openCanvas();
    await findNode("nightly");
    await canvasToSettle();
    await settle();

    expect(saveButton()).toBeDisabled();

    await refocus();

    expect(saveButton()).toBeDisabled();
    expect(sent("workflows.update")).toHaveLength(0);
  });

  it("saves a node dropped on the canvas", async () => {
    const { user, reload } = await openCanvas();
    await canvasToSettle();

    await dropOnCanvas(SPARE, "spare");
    expect(saveButton()).toBeEnabled();
    await save(user);

    const [dropped] = nodesNamed("spare");
    const at = shownPosition(dropped!);
    expect(lastSavedGraph().nodes).toEqual([
      { eventId: NIGHTLY, x: 300, y: 105 },
      { eventId: WEEKLY, x: 600, y: 105 },
      { eventId: SPARE, ...at },
    ]);
    expect(storedGraph().nodes).toEqual(lastSavedGraph().nodes);
    expect(storedGraph().edges).toEqual([[NIGHTLY, WEEKLY]]);
    expect(saveButton()).toBeDisabled();

    await reload();
    expect(shownPosition(await findNode("spare"))).toEqual(at);
    expect(canvasNodes()).toHaveLength(3);
  });

  it("saves a node moved on the canvas", async () => {
    const { user, reload } = await openCanvas();
    await canvasToSettle();

    const movedTo = await dragNode("nightly", { x: 150, y: 90 });
    expect(movedTo).not.toEqual({ x: 300, y: 105 });
    await waitFor(() => expect(saveButton()).toBeEnabled(), FIND);
    await save(user);

    expect(lastSavedGraph().nodes).toEqual([
      { eventId: NIGHTLY, ...movedTo },
      { eventId: WEEKLY, x: 600, y: 105 },
    ]);
    expect(storedGraph().nodes).toEqual(lastSavedGraph().nodes);
    expect(saveButton()).toBeDisabled();

    await reload();
    expect(shownPosition(await findNode("nightly"))).toEqual(movedTo);
  });

  it("saves the deletion of a node with no connections", async () => {
    mockNodes.push({ id: 3, eventId: SPARE, x: 900, y: 105 });
    const { user } = await openCanvas();
    await canvasToSettle();

    await deleteNode(user, "spare");
    expect(saveButton()).toBeEnabled();
    await save(user);

    expect(storedGraph()).toEqual({
      nodes: [
        { eventId: NIGHTLY, x: 300, y: 105 },
        { eventId: WEEKLY, x: 600, y: 105 },
      ],
      edges: [[NIGHTLY, WEEKLY]],
    });
  });

  it("saves the first node dropped on a workflow with none", async () => {
    mockNodes = [];
    mockConnections = [];
    const { user } = await openCanvas();
    await screen.findByText("Build your workflow", undefined, FIND);
    await settle();
    expect(saveButton()).toBeDisabled();

    await dropOnCanvas(SPARE, "spare");
    expect(saveButton()).toBeEnabled();
    await save(user);

    expect(storedGraph().nodes).toEqual([
      { eventId: SPARE, ...shownPosition(nodesNamed("spare")[0]!) },
    ]);
  });

  it("keeps an edit that isn't saved when the workflow is read again", async () => {
    const { user } = await openCanvas();
    await canvasToSettle();
    await deleteNode(user, "weekly");
    expect(saveButton()).toBeEnabled();

    await refocus();

    expect(saveButton()).toBeEnabled();
    expect(canvasNodes()).toHaveLength(1);
    await save(user);
    expect(storedGraph()).toEqual({
      nodes: [{ eventId: NIGHTLY, x: 300, y: 105 }],
      edges: [],
    });
  });

  it("stays off after a save when the nodes come back with new ids, and saves the next edit", async () => {
    const { user } = await openCanvas();
    await canvasToSettle();
    await dropOnCanvas(SPARE, "spare");
    await save(user);
    expect(mockNodes.map(({ id }) => id)).toEqual([100, 101, 102]);

    await refocus();
    expect(saveButton()).toBeDisabled();

    await dropOnCanvas(SPARE, "spare");
    expect(saveButton()).toBeEnabled();
    await save(user);

    expect(storedGraph().nodes.map(({ eventId }) => eventId)).toEqual([
      NIGHTLY,
      WEEKLY,
      SPARE,
      SPARE,
    ]);
    expect(storedGraph().edges).toEqual([[NIGHTLY, WEEKLY]]);
    expect(mockConnections[0]!.connectionType).toBe(ConnectionType.ON_SUCCESS);
    expect(saveButton()).toBeDisabled();
  });

  it("is off again when an edit is undone", async () => {
    const { user } = await openCanvas();
    await canvasToSettle();
    await deleteNode(user, "weekly");
    expect(saveButton()).toBeEnabled();

    await user.click(undoButton());

    await findNode("weekly");
    await waitFor(() => expect(saveButton()).toBeDisabled(), FIND);
  });

  it("has Undo all changes go back to what was last saved", async () => {
    const { user } = await openCanvas();
    await canvasToSettle();
    await dropOnCanvas(SPARE, "spare");
    await save(user);

    await dropOnCanvas(SPARE, "spare");
    expect(nodesNamed("spare")).toHaveLength(2);
    expect(saveButton()).toBeEnabled();

    await user.click(undoAllButton());

    await waitFor(() => expect(nodesNamed("spare")).toHaveLength(1), FIND);
    expect(canvasNodes()).toHaveLength(3);
    await waitFor(() => expect(saveButton()).toBeDisabled(), FIND);
  });
});
