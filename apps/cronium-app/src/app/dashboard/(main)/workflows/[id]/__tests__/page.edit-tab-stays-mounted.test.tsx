/**
 * What's typed on a workflow page's Edit tab has to survive a visit to another tab.
 * Radix unmounts an inactive tab's content, so going to Overview, Canvas or Execution
 * History took the Details form with it, and coming back built a new one from the
 * stored workflow: everything typed was gone, with nothing to say so, and the next Save
 * wrote the stored values. The form now stays from the first time the tab opens.
 *
 * Keeping it mustn't change the rest: nothing of the form shows or can be reached from
 * another tab, it isn't built until the Edit tab first opens, and a stored change that
 * arrives while it's out of sight reaches the fields nobody edited, as it would on the
 * tab itself. Nor should it cost the other tabs anything: the page renders again on
 * every poll of a running workflow, and the form only needs to when its props change.
 *
 * Only the network is fake, as in page.edit-tab-keeps-typing.test.tsx. The page and the
 * form run over `TrpcProvider`'s real QueryClient, focus handling included, and each
 * answer is built afresh with new Dates, as superjson builds them.
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

jest.mock("@/lib/security/field-secret", () => ({
  decryptEnvVarValue: (stored: string) => stored,
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
              Promise.resolve()
                .then(() => mockServerAnswer(request))
                .then(
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

// What the other tabs show isn't what's being tested, only that they can be visited.
// Overview's graph counts the page's renders, since the page renders it every time.
let mockPageRenders = 0;
jest.mock("@/components/workflows/WorkflowCanvas-lazy", () => ({
  __esModule: true,
  default: () => <p>The canvas</p>,
}));
jest.mock("@/components/workflows/WorkflowExecutionHistory", () => ({
  __esModule: true,
  default: () => <p>The execution history</p>,
}));
jest.mock("@/components/workflows/WorkflowExecutionGraph", () => ({
  __esModule: true,
  default: () => {
    mockPageRenders++;
    return <p>The run graph</p>;
  },
}));

// The real form, counting the times the page renders it.
let mockFormRenders = 0;
jest.mock("@/components/workflows/WorkflowDetailsForm", () => {
  const { default: WorkflowDetailsForm } = jest.requireActual<
    typeof import("@/components/workflows/WorkflowDetailsForm")
  >("@/components/workflows/WorkflowDetailsForm");
  return {
    __esModule: true,
    default: (props: React.ComponentProps<typeof WorkflowDetailsForm>) => {
      mockFormRenders++;
      return <WorkflowDetailsForm {...props} />;
    },
  };
});

import WorkflowDetailsPage from "../page";
import { TrpcProvider } from "@/components/providers/TrpcProvider";
import { toWorkflowApiDto } from "@/server/security/api-dto";
import { EventStatus, RunLocation, WorkflowTriggerType } from "@/shared/schema";

// Each test renders the whole page, and CI runs with coverage.
jest.setTimeout(120_000);

// jsdom lacks the pointer-capture and scroll APIs Radix Select relies on.
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: jest.fn(),
    hasPointerCapture: jest.fn(() => false),
    setPointerCapture: jest.fn(),
    releasePointerCapture: jest.fn(),
  });
});

const OWNER = "owner";
const WORKFLOW_ID = 9;
const FIND = { timeout: 60_000 };
const OTHER_TABS = ["Overview", "Canvas", "Execution History"];

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
    case "workflows.execute":
      return { executionId: 77 };
    case "workflows.getExecution":
      return {
        id: 77,
        workflowId: WORKFLOW_ID,
        status: "RUNNING",
        startedAt: new Date(),
        completedAt: null,
        totalDuration: null,
      };
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

async function openPage(hash: string) {
  window.location.hash = hash;
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
  await screen.findByRole("heading", { level: 1, name: "Deploy" }, FIND);
  return userEvent.setup();
}

async function openEditTab() {
  const user = await openPage("#edit");
  await waitFor(() => expect(nameField()).toHaveValue("Deploy"), FIND);
  return user;
}

const tab = (name: string) => screen.getByRole("tab", { name });

async function openTab(user: UserEvent, name: string) {
  await user.click(tab(name));
  await waitFor(() =>
    expect(tab(name)).toHaveAttribute("aria-selected", "true"),
  );
}

// By placeholder, so they're found while hidden too.
const nameField = () => screen.getByPlaceholderText("Enter workflow name");
const descriptionField = () =>
  screen.getByPlaceholderText("Enter workflow description");
const addTagField = () => screen.getByPlaceholderText("Add tag");
const statusField = () => screen.getByRole("combobox", { name: "Status" });
/** The trigger type's list has no label of its own, so it's found by what it shows. */
const triggerField = (showing: string) => {
  const field = screen
    .getAllByRole("combobox")
    .find((combobox) => combobox.textContent?.includes(showing));
  if (!field) throw new Error(`No list showing ${showing}`);
  return field;
};
const tagChip = (tag: string) =>
  screen.queryAllByText(tag, { selector: "span" })[0] ?? null;
const shownTags = () =>
  ["keep", "drop", "new"].filter((tag) => tagChip(tag) !== null);

async function replaceText(user: UserEvent, field: HTMLElement, text: string) {
  await user.clear(field);
  await user.type(field, text);
}

async function choose(user: UserEvent, list: HTMLElement, option: string) {
  await user.click(list);
  await user.click(await screen.findByRole("option", { name: option }));
}

/** Long enough for an answer to reach the page, and the page's effects to run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

/** Leave the window and come back, as switching to another app and back does. */
async function refocus() {
  const reads = sent("workflows.getById").length;
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(
    () => expect(sent("workflows.getById")).toHaveLength(reads + 1),
    FIND,
  );
  await settle();
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

beforeEach(() => {
  mockStored = storedWorkflow();
  mockSaves = 0;
  mockRequests.length = 0;
});

afterEach(() => {
  window.location.hash = "";
  focusManager.setFocused(undefined);
});

describe("a workflow page's Edit tab, left for another tab and back", () => {
  it.each(OTHER_TABS)(
    "keeps a typed name through a visit to %s, and saves it",
    async (other) => {
      const user = await openEditTab();
      await replaceText(user, nameField(), "typed name");

      await openTab(user, other);
      await openTab(user, "Edit");

      expect(nameField()).toHaveValue("typed name");
      expect(await save(user)).toMatchObject({ name: "typed name" });
    },
  );

  it("keeps every kind of edit, and a tag not yet added, through visits to each tab", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "typed name");
    await replaceText(user, descriptionField(), "typed description");
    await choose(user, statusField(), "Paused");
    await choose(user, triggerField("Manual"), "Scheduled");
    await user.click(
      screen.getByRole("checkbox", { name: "Use Cron Expression" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Cron Expression" }),
      "0 3 * * *",
    );
    await user.click(within(tagChip("drop")!).getByRole("button"));
    await user.type(addTagField(), "new{Enter}");
    await user.type(addTagField(), "half-typed");
    await user.click(
      screen.getByRole("switch", { name: "Make workflow publicly shareable" }),
    );

    for (const other of OTHER_TABS) {
      await openTab(user, other);
      await openTab(user, "Edit");
    }

    expect(nameField()).toHaveValue("typed name");
    expect(descriptionField()).toHaveValue("typed description");
    expect(statusField()).toHaveTextContent("Paused");
    expect(triggerField("Scheduled")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Use Cron Expression" }),
    ).toBeChecked();
    expect(
      screen.getByRole("textbox", { name: "Cron Expression" }),
    ).toHaveValue("0 3 * * *");
    expect(shownTags()).toEqual(["keep", "new"]);
    expect(addTagField()).toHaveValue("half-typed");
    expect(
      screen.getByRole("switch", { name: "Make workflow publicly shareable" }),
    ).toBeChecked();
    expect(await save(user)).toMatchObject({
      name: "typed name",
      description: "typed description",
      status: EventStatus.PAUSED,
      triggerType: WorkflowTriggerType.SCHEDULE,
      customSchedule: "0 3 * * *",
      tags: ["keep", "new"],
      shared: true,
    });
  });

  it("keeps an emptied name and its error, and nothing is sent until it's fixed", async () => {
    const user = await openEditTab();
    await user.clear(nameField());
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByText("Name is required", undefined, FIND);
    await replaceText(user, descriptionField(), "typed description");

    await openTab(user, "Overview");
    await openTab(user, "Edit");

    expect(nameField()).toHaveValue("");
    expect(screen.getByText("Name is required")).toBeVisible();
    expect(descriptionField()).toHaveValue("typed description");
    expect(sent("workflows.update")).toHaveLength(0);

    await user.type(nameField(), "fixed");
    expect(await save(user)).toMatchObject({
      name: "fixed",
      description: "typed description",
    });
  });

  it("shows a status set from the header on another tab, and keeps what was typed", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "typed name");

    await openTab(user, "Overview");
    await user.click(
      screen.getByRole("button", { name: "Header status: ACTIVE" }),
    );
    await waitFor(() => expect(sent("workflows.update")).toHaveLength(1), FIND);
    await screen.findByRole("button", { name: "Header status: PAUSED" }, FIND);
    await settle();
    await openTab(user, "Edit");

    expect(nameField()).toHaveValue("typed name");
    expect(statusField()).toHaveTextContent("Paused");
    expect(await save(user)).toMatchObject({
      name: "typed name",
      status: EventStatus.PAUSED,
    });
  });

  it("takes a change made elsewhere and read while on another tab into the fields nobody edited", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "typed name");

    await openTab(user, "Execution History");
    mockStored.name = "Renamed elsewhere";
    mockStored.description = "Changed elsewhere";
    await refocus();
    await openTab(user, "Edit");

    expect(nameField()).toHaveValue("typed name");
    expect(descriptionField()).toHaveValue("Changed elsewhere");
    expect(await save(user)).toMatchObject({
      name: "typed name",
      description: "Changed elsewhere",
    });
  });

  it("after a save, shows what was saved and a later change made elsewhere on coming back", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "renamed");
    expect(await save(user)).toMatchObject({ name: "renamed" });

    await openTab(user, "Overview");
    mockStored.description = "Changed elsewhere";
    await refocus();
    await openTab(user, "Edit");

    expect(nameField()).toHaveValue("renamed");
    expect(descriptionField()).toHaveValue("Changed elsewhere");
  });

  it("shows nothing of the form, and leaves none of it to reach, while another tab shows", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "typed name");

    for (const other of OTHER_TABS) {
      await openTab(user, other);

      expect(tab(other)).toHaveAttribute("aria-selected", "true");
      // Kept or not, no copy of the form shows.
      for (const field of screen.queryAllByPlaceholderText(
        "Enter workflow name",
      )) {
        expect(field).not.toBeVisible();
      }
      expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
      expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    }
    expect(screen.getByText("The execution history")).toBeVisible();
  });

  it("doesn't build the form until the Edit tab first opens", async () => {
    const user = await openPage("");

    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByPlaceholderText("Enter workflow name")).toBeNull();
    await openTab(user, "Canvas");
    expect(screen.queryByPlaceholderText("Enter workflow name")).toBeNull();

    await openTab(user, "Edit");
    await waitFor(() => expect(nameField()).toHaveValue("Deploy"), FIND);
    expect(nameField()).toBeVisible();
  });

  // The page renders again on every poll of a running workflow, and on Run Now.
  it("doesn't render the kept form again while the page does and nothing it's given has changed", async () => {
    const user = await openEditTab();
    await replaceText(user, nameField(), "typed name");
    await openTab(user, "Overview");
    const formRenders = mockFormRenders;
    const pageRenders = mockPageRenders;

    await user.click(screen.getByRole("button", { name: "Run Now" }));
    await waitFor(
      () => expect(sent("workflows.execute")).toHaveLength(1),
      FIND,
    );
    await settle();

    expect(mockPageRenders).toBeGreaterThan(pageRenders);
    expect(mockFormRenders).toBe(formRenders);
    await openTab(user, "Edit");
    expect(nameField()).toHaveValue("typed name");
  });
});
