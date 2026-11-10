/**
 * The Save on a workflow page's Edit tab saves the workflow's details, and nothing else.
 * It used to send the page's whole graph with them, and `workflows.update` takes any graph
 * as a new one: it deletes every node and connection and makes them again with new ids.
 * The engine then fails a running workflow's remaining steps with `Node N no longer exists
 * in the workflow`. So a rename did that. It also put the page's copy of the graph over one
 * saved elsewhere after the page read it, and saved whatever the canvas held that its own
 * Save hadn't been pressed for.
 *
 * Only the network is fake. The page, the Details form and the canvas run on real React
 * Flow over `TrpcProvider`'s real QueryClient. The server's side keeps the workflow in
 * memory and, like the real one, makes every node again with a new id whenever a save
 * sends a graph. Each read builds new `Date`s, as superjson does.
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

let mockWorkflow: Row;
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
    // jsdom, and a node dropped there would land at NaN. The view stays at 1:1 instead.
    ReactFlow: (props: Props) =>
      ReactActual.createElement(actual.ReactFlow, {
        ...props,
        onInit: (instance: Parameters<NonNullable<Props["onInit"]>>[0]) =>
          props.onInit?.({ ...instance, fitView: () => Promise.resolve(true) }),
      }),
  };
});

// Not what's being tested, and it needs a lot of answers.
jest.mock("@/components/workflows/WorkflowExecutionHistory", () => ({
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

// Each test renders the whole page, some drive real React Flow, and CI runs with coverage.
jest.setTimeout(120_000);

const OWNER = "owner";
const WORKFLOW_ID = 9;
const NIGHTLY = 42;
const WEEKLY = 43;
const SPARE = 44;
const FIND = { timeout: 60_000 };
const CREATED_AT = new Date("2026-01-02T03:04:05.000Z");

/** Two steps, the second running when the first succeeds. */
const STARTING_NODES: readonly StoredNode[] = [
  { id: 1, eventId: NIGHTLY, x: 300, y: 105 },
  { id: 2, eventId: WEEKLY, x: 600, y: 105 },
];
const STARTING_CONNECTIONS: readonly StoredConnection[] = [
  { id: 3, source: 1, target: 2, connectionType: ConnectionType.ON_SUCCESS },
];

function storedWorkflow(): Row {
  return {
    id: WORKFLOW_ID,
    userId: OWNER,
    name: "Deploy",
    description: "Ships the build",
    triggerType: WorkflowTriggerType.MANUAL,
    status: EventStatus.ACTIVE,
    tags: ["ops"],
    shared: false,
    webhookKey: null,
    webhookKeyHash: null,
    overrideEventServers: false,
    overrideServerIds: [],
    customSchedule: null,
    scheduleNumber: null,
    scheduleUnit: null,
    nextRunAt: null,
    runLocation: RunLocation.LOCAL,
    source: null,
  };
}

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
  const row = JSON.parse(JSON.stringify(mockWorkflow)) as Row;
  return toWorkflowApiDto(
    {
      ...row,
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
    case "workflows.update": {
      const { id: _id, nodes, edges, ...fields } = input;
      // Like the real one, a null leaves the stored value as it is.
      for (const [key, value] of Object.entries(fields)) {
        if (key in mockWorkflow && value !== null) mockWorkflow[key] = value;
      }
      if (nodes !== undefined) {
        saveGraph(nodes as SentNode[], edges as SentEdge[]);
      }
      return workflowDto();
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

/** The stored steps by event, and connections by the events they join. */
function storedGraph() {
  const eventOf = new Map(mockNodes.map((node) => [node.id, node.eventId]));
  return {
    events: mockNodes.map(({ eventId }) => eventId),
    connections: mockConnections.map(({ source, target, connectionType }) => [
      eventOf.get(source),
      eventOf.get(target),
      connectionType,
    ]),
  };
}

/** A failure would otherwise spend 7 seconds on react-query's retries. */
function WithoutRetries() {
  useQueryClient().setDefaultOptions({ queries: { retry: false } });
  return null;
}

const params = Promise.resolve({ id: String(WORKFLOW_ID) });

async function openPage(tab: "edit" | "canvas") {
  window.location.hash = `#${tab}`;
  await act(async () => {
    render(
      <TrpcProvider>
        <WithoutRetries />
        <Suspense fallback={null}>
          <WorkflowDetailsPage params={params} />
        </Suspense>
      </TrpcProvider>,
    );
  });
  return userEvent.setup();
}

const nameField = () => screen.getByPlaceholderText("Enter workflow name");
const descriptionField = () =>
  screen.getByPlaceholderText("Enter workflow description");
const detailsLoaded = () =>
  waitFor(() => expect(nameField()).toHaveValue("Deploy"), FIND);

async function replaceText(user: UserEvent, field: HTMLElement, text: string) {
  await user.clear(field);
  await user.type(field, text);
}

/** Long enough for anything still on its way to have landed. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

/** Press a Save and wait for what it sent to have been answered. */
async function pressSave(user: UserEvent, name: string) {
  const saves = sent("workflows.update").length;
  await user.click(screen.getByRole("button", { name }));
  await waitFor(
    () => expect(sent("workflows.update")).toHaveLength(saves + 1),
    FIND,
  );
  await settle();
  return sent("workflows.update")[saves]!;
}

const saveDetails = (user: UserEvent) => pressSave(user, "Save Changes");
const canvasSaveButton = () => screen.getByRole("button", { name: "Save" });

const nodesNamed = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(".react-flow__node")].filter(
    (node) => node.textContent?.includes(name),
  );

/** The canvas ignores edits for its first moments, and enables this when it's done. */
const canvasToSettle = () =>
  waitFor(
    () =>
      expect(
        screen.getByRole("button", { name: "Undo all changes" }),
      ).toBeEnabled(),
    FIND,
  );

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

describe("the Save on a workflow page's Edit tab", () => {
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
    mockWorkflow = storedWorkflow();
    mockEvents = new Map(
      [
        storedEvent(NIGHTLY, "nightly"),
        storedEvent(WEEKLY, "weekly"),
        storedEvent(SPARE, "spare"),
      ].map((row) => [row.id as number, row]),
    );
    mockNodes = STARTING_NODES.map((node) => ({ ...node }));
    mockConnections = STARTING_CONNECTIONS.map((connection) => ({
      ...connection,
    }));
    mockNextId = 100;
    mockRequests.length = 0;
  });

  afterEach(() => {
    window.location.hash = "";
    focusManager.setFocused(undefined);
  });

  it("saves a rename and a new description without making the nodes and connections again", async () => {
    const user = await openPage("edit");
    await detailsLoaded();

    await replaceText(user, nameField(), "Deploy v2");
    await replaceText(user, descriptionField(), "Ships it twice");
    const request = await saveDetails(user);

    expect(mockWorkflow).toMatchObject({
      name: "Deploy v2",
      description: "Ships it twice",
    });
    // The same rows, ids and all: a run part way through still finds its next step.
    expect(mockNodes).toEqual(STARTING_NODES);
    expect(mockConnections).toEqual(STARTING_CONNECTIONS);
    expect(request).not.toHaveProperty("nodes");
    expect(request).not.toHaveProperty("edges");
  });

  it("doesn't put back a graph saved elsewhere after the page read it", async () => {
    const user = await openPage("edit");
    await detailsLoaded();

    // Saved from another tab, the /edit page or the API: new steps, new ids.
    mockNodes = [
      { id: 50, eventId: WEEKLY, x: 300, y: 105 },
      { id: 51, eventId: SPARE, x: 600, y: 105 },
    ];
    mockConnections = [
      { id: 52, source: 50, target: 51, connectionType: ConnectionType.ALWAYS },
    ];
    const savedElsewhere = {
      nodes: mockNodes.map((node) => ({ ...node })),
      connections: mockConnections.map((connection) => ({ ...connection })),
    };

    await replaceText(user, nameField(), "Deploy v2");
    await saveDetails(user);

    expect(mockWorkflow.name).toBe("Deploy v2");
    expect({ nodes: mockNodes, connections: mockConnections }).toEqual(
      savedElsewhere,
    );
  });

  it("leaves a change on the canvas to the canvas's own Save, which still offers it", async () => {
    const user = await openPage("canvas");
    await canvasToSettle();
    await dropOnCanvas(SPARE, "spare");
    expect(canvasSaveButton()).toBeEnabled();

    await user.click(screen.getByRole("tab", { name: "Edit" }));
    await detailsLoaded();
    await replaceText(user, nameField(), "Deploy v2");
    const request = await saveDetails(user);

    expect(mockWorkflow.name).toBe("Deploy v2");
    expect(mockNodes).toEqual(STARTING_NODES);
    expect(mockConnections).toEqual(STARTING_CONNECTIONS);
    expect(request).not.toHaveProperty("nodes");

    await user.click(screen.getByRole("tab", { name: "Canvas" }));
    await waitFor(() => expect(nodesNamed("spare")).toHaveLength(1), FIND);
    expect(canvasSaveButton()).toBeEnabled();

    await pressSave(user, "Save");

    expect(storedGraph()).toEqual({
      events: [NIGHTLY, WEEKLY, SPARE],
      connections: [[NIGHTLY, WEEKLY, ConnectionType.ON_SUCCESS]],
    });
    expect(mockWorkflow.name).toBe("Deploy v2");
    expect(canvasSaveButton()).toBeDisabled();
  });
});
