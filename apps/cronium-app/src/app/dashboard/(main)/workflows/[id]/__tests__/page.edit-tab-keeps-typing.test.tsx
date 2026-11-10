/**
 * What's typed on a workflow page's Edit tab has to survive what goes on around it.
 * Coming back to the window reads the workflow again, and every read is a new object
 * even when nothing changed: superjson builds new `Date`s, and React Query's structural
 * sharing only reuses a `Date` that is the same object. The Details form reset itself
 * whenever its workflow was a new object, so a refocus put the stored values back over
 * what was typed, and so did setting the status from the page's header.
 *
 * What nobody has edited goes the other way. A save sends the whole form, so a field
 * still showing an old value would write it over a newer one: it takes the new value.
 * After a save, the form starts again from what was saved.
 *
 * Only the network is fake. The page and the form run over `TrpcProvider`'s real
 * QueryClient, focus handling included. Each answer is built afresh by the real DTO,
 * with new Dates, as superjson builds them: one shared `Date` would let structural
 * sharing hand back the old object, and the bug wouldn't show.
 */
import React, { Suspense } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { focusManager, useQueryClient } from "@tanstack/react-query";

interface Request {
  path: string;
  input: Record<string, unknown>;
}

type Row = Record<string, unknown>;

/** The workflow as the database holds it. */
let mockStored: Row;
let mockSaves = 0;
const mockRequests: Request[] = [];
/** Paths that wait for the test to let them through, and the requests waiting. */
const mockHeldPaths = new Set<string>();
let mockReleaseHeld: Array<() => void> = [];

jest.mock("@/lib/security/field-secret", () => ({
  decryptEnvVarValue: (stored: string) => stored,
}));

/** An answer is settled when the request arrives, so a held one comes back old. */
async function mockAnswer(request: Request): Promise<unknown> {
  mockRequests.push(request);
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
  useParams: () => ({ id: "9" }),
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/dashboard/workflows/9",
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}));

// The header's status menu, as buttons: what it does is call onStatusChange.
jest.mock("@/components/ui/clickable-status-badge", () => ({
  ClickableStatusBadge: ({
    currentStatus,
    onStatusChange,
  }: {
    currentStatus: string;
    onStatusChange: (status: string) => Promise<void>;
  }) => (
    <button type="button" onClick={() => void onStatusChange("PAUSED")}>
      Header status: {currentStatus}
    </button>
  ),
}));

// The other tabs aren't what's being tested.
jest.mock("@/components/workflows/WorkflowCanvas-lazy", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/workflows/WorkflowExecutionHistory", () => ({
  __esModule: true,
  default: () => null,
}));

import WorkflowDetailsPage from "../page";
import { TrpcProvider } from "@/components/providers/TrpcProvider";
import { toWorkflowApiDto } from "@/server/security/api-dto";
import { EventStatus, RunLocation, WorkflowTriggerType } from "@/shared/schema";

// Each test renders the whole page, and CI runs with coverage.
jest.setTimeout(120_000);

const OWNER = "owner";
const WORKFLOW_ID = 9;
const FIND = { timeout: 60_000 };

function storedWorkflow(): Row {
  return {
    id: WORKFLOW_ID,
    userId: OWNER,
    name: "Deploy",
    description: "Ships the build",
    triggerType: WorkflowTriggerType.MANUAL,
    status: EventStatus.ACTIVE,
    tags: ["keep", "drop"],
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

/** Everything new for each answer, Dates included, as the real link's superjson does. */
function workflowDto() {
  const row = JSON.parse(JSON.stringify(mockStored)) as Row;
  return toWorkflowApiDto(
    {
      ...row,
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
      updatedAt: new Date(Date.UTC(2026, 1, 3, 4, 5, mockSaves)),
      nodes: [],
      connections: [],
    } as never,
    OWNER,
  );
}

function mockServerAnswer({ path, input }: Request): unknown {
  switch (path) {
    case "workflows.getById":
      return { data: workflowDto() };
    case "workflows.update": {
      const { id: _id, nodes: _nodes, edges: _edges, ...fields } = input;
      // Like the real one, a null leaves the stored value as it is.
      for (const [key, value] of Object.entries(fields)) {
        if (key in mockStored && value !== null) mockStored[key] = value;
      }
      mockSaves++;
      return workflowDto();
    }
    case "workflows.getExecutions":
      return { executions: { executions: [], total: 0 }, hasMore: false };
    case "events.getAll":
      return { events: [], total: 0, hasMore: false };
    default:
      throw new Error(`Nothing answers ${path} in this test`);
  }
}

function sent(path: string): Array<Record<string, unknown>> {
  return mockRequests
    .filter((request) => request.path === path)
    .map((request) => request.input);
}

/** A failure would otherwise spend 7 seconds on react-query's retries. */
function WithoutRetries() {
  useQueryClient().setDefaultOptions({ queries: { retry: false } });
  return null;
}

async function openEditTab() {
  window.location.hash = "#edit";
  const params = Promise.resolve({ id: String(WORKFLOW_ID) });
  await act(async () =>
    render(
      <TrpcProvider>
        <WithoutRetries />
        <Suspense fallback={null}>
          <WorkflowDetailsPage params={params} />
        </Suspense>
      </TrpcProvider>,
    ),
  );
  const user = userEvent.setup();
  await waitFor(() => expect(nameField()).toHaveValue("Deploy"), FIND);
  return user;
}

const nameField = () => screen.getByPlaceholderText("Enter workflow name");
const descriptionField = () =>
  screen.getByPlaceholderText("Enter workflow description");
const statusField = () => screen.getByRole("combobox", { name: "Status" });
const tagChip = (tag: string) =>
  screen.queryAllByText(tag, { selector: "span" })[0] ?? null;
const shownTags = () =>
  ["keep", "drop", "new"].filter((tag) => tagChip(tag) !== null);

async function replaceText(user: UserEvent, field: HTMLElement, text: string) {
  await user.clear(field);
  await user.type(field, text);
}

/** Long enough for an answer to reach the page, and the page's effects to run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

/** Leave the window and come back, as switching to another app and back does. */
async function refocus({ wait = true } = {}) {
  const reads = sent("workflows.getById").length;
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(
    () => expect(sent("workflows.getById")).toHaveLength(reads + 1),
    FIND,
  );
  if (wait) await settle();
}

async function save(user: UserEvent) {
  const saves = sent("workflows.update").length;
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(
    () => expect(sent("workflows.update")).toHaveLength(saves + 1),
    FIND,
  );
  await settle();
  return sent("workflows.update")[saves]!;
}

const letHeldRequestsThrough = () =>
  act(async () => {
    mockHeldPaths.clear();
    mockReleaseHeld.splice(0).forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

beforeEach(() => {
  mockStored = storedWorkflow();
  mockSaves = 0;
  mockRequests.length = 0;
  mockHeldPaths.clear();
  mockReleaseHeld = [];
});

afterEach(() => {
  window.location.hash = "";
  focusManager.setFocused(undefined);
});

describe("a workflow page's Edit tab", () => {
  it("keeps a typed name when the window regains focus with nothing changed", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "typed name");

    await refocus();

    expect(nameField()).toHaveValue("typed name");
  });

  it("takes changes made elsewhere into fields nobody edited, and saves them with what was typed", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "typed name");

    mockStored.description = "Changed elsewhere";
    mockStored.status = EventStatus.PAUSED;
    await refocus();

    expect(nameField()).toHaveValue("typed name");
    expect(descriptionField()).toHaveValue("Changed elsewhere");
    expect(statusField()).toHaveTextContent("Paused");
    expect(await save(user)).toMatchObject({
      name: "typed name",
      description: "Changed elsewhere",
      status: EventStatus.PAUSED,
    });
  });

  it("keeps what was typed when the status is set from the header, and shows that status", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "typed name");

    await user.click(
      screen.getByRole("button", { name: "Header status: ACTIVE" }),
    );
    await waitFor(() => expect(sent("workflows.update")).toHaveLength(1), FIND);
    await screen.findByRole("button", { name: "Header status: PAUSED" }, FIND);
    await settle();

    expect(nameField()).toHaveValue("typed name");
    expect(statusField()).toHaveTextContent("Paused");
    expect(await save(user)).toMatchObject({
      name: "typed name",
      status: EventStatus.PAUSED,
    });
  });

  it("keeps a removed tag removed through a read that brings a change", async () => {
    const user = await openEditTab();
    await user.click(within(tagChip("drop")!).getByRole("button"));
    expect(shownTags()).toEqual(["keep"]);

    mockStored.description = "Changed elsewhere";
    await refocus();

    expect(descriptionField()).toHaveValue("Changed elsewhere");
    expect(shownTags()).toEqual(["keep"]);
    expect(await save(user)).toMatchObject({ tags: ["keep"] });
  });

  it("keeps an added tag through a read that brings a change", async () => {
    const user = await openEditTab();
    await user.type(screen.getByPlaceholderText("Add tag"), "new{Enter}");
    expect(shownTags()).toEqual(["keep", "drop", "new"]);

    mockStored.description = "Changed elsewhere";
    await refocus();

    expect(descriptionField()).toHaveValue("Changed elsewhere");
    expect(shownTags()).toEqual(["keep", "drop", "new"]);
    expect(await save(user)).toMatchObject({ tags: ["keep", "drop", "new"] });
  });

  it("keeps the server override switched off through a read that brings a change", async () => {
    mockStored.overrideEventServers = true;
    mockStored.overrideServerIds = [6, 7];
    const user = await openEditTab();
    const override = () =>
      screen.getByRole("switch", { name: "Override Event Server Settings" });
    await user.click(override());

    mockStored.description = "Changed elsewhere";
    await refocus();

    expect(descriptionField()).toHaveValue("Changed elsewhere");
    expect(override()).not.toBeChecked();
    expect(await save(user)).toMatchObject({
      overrideEventServers: false,
      overrideServerIds: [],
    });
  });

  it("starts from what was saved, so a later change made elsewhere shows", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "renamed");
    expect(await save(user)).toMatchObject({ name: "renamed" });
    expect(nameField()).toHaveValue("renamed");

    mockStored.name = "renamed elsewhere";
    await refocus();

    expect(nameField()).toHaveValue("renamed elsewhere");
    expect(await save(user)).toMatchObject({ name: "renamed elsewhere" });
  });

  it("keeps what was typed while a save was on its way, as an edit", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "renamed");

    mockHeldPaths.add("workflows.update");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(sent("workflows.update")).toHaveLength(1), FIND);
    await replaceText(user, descriptionField(), "typed while saving");
    await letHeldRequestsThrough();
    await settle();

    expect(nameField()).toHaveValue("renamed");
    expect(descriptionField()).toHaveValue("typed while saving");

    mockStored.description = "Changed elsewhere";
    await refocus();

    expect(descriptionField()).toHaveValue("typed while saving");
    expect(await save(user)).toMatchObject({
      name: "renamed",
      description: "typed while saving",
    });
  });

  it("doesn't let a read that left before a save put the old values back after it", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "renamed");

    // The read goes out before the save, and its answer is the old workflow.
    mockHeldPaths.add("workflows.getById");
    await refocus({ wait: false });
    mockHeldPaths.clear();
    expect(await save(user)).toMatchObject({ name: "renamed" });
    expect(nameField()).toHaveValue("renamed");

    await letHeldRequestsThrough();
    await settle();

    expect(nameField()).toHaveValue("renamed");
    expect(
      screen.getByRole("heading", { level: 1, name: "renamed" }),
    ).toBeInTheDocument();
  });
});
