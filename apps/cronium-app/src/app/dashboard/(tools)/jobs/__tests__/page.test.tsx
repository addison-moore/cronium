/**
 * The jobs page reads its filters from the address. Apply Filters only ever
 * changed the address: the page asked jobs.list for the first 50 jobs whatever
 * it said, and the controls started from "all" whatever it said, so a filtered
 * address showed every job under controls that claimed nothing was filtered.
 *
 * The page is an async server component. This renders it as the server would:
 * each async component is awaited, and the client components it returns are left
 * for React to render.
 */
import React, {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import JobsPage from "../page";
import { api } from "@/trpc/server";
import { JobPriority, JobStatus, JobType, type Job } from "@/shared/schema";

jest.mock("@/trpc/server", () => ({
  api: { jobs: { list: jest.fn() } },
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const mockList = api.jobs.list as unknown as jest.Mock;

function job(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    eventId: 1,
    userId: "user-1",
    type: JobType.SCRIPT,
    status: JobStatus.COMPLETED,
    priority: JobPriority.NORMAL,
    payload: {},
    metadata: {},
    attempts: 0,
    createdAt: new Date("2026-11-09T10:00:00.000Z"),
    updatedAt: new Date("2026-11-09T10:00:00.000Z"),
    ...overrides,
  } as unknown as Job;
}

function isAsyncComponent(
  type: unknown,
): type is (props: unknown) => Promise<ReactNode> {
  return (
    typeof type === "function" && type.constructor.name === "AsyncFunction"
  );
}

async function resolveServerComponents(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) {
    return Promise.all(node.map(resolveServerComponents));
  }
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (isAsyncComponent(element.type)) {
    return resolveServerComponents(await element.type(element.props));
  }
  const { children } = element.props;
  if (children === undefined) return element;
  const resolved = await resolveServerComponents(children);
  return Array.isArray(resolved)
    ? cloneElement(element, undefined, ...(resolved as ReactNode[]))
    : cloneElement(element, undefined, resolved);
}

async function pageFor(params: Record<string, string | string[]>) {
  return resolveServerComponents(
    await JobsPage({ searchParams: Promise.resolve(params) }),
  );
}

const searchBox = () => screen.getByRole("textbox", { name: "Search" });
const statusSelect = () => screen.getByRole("combobox", { name: "Status" });
const typeSelect = () => screen.getByRole("combobox", { name: "Type" });
const rowIds = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]!.textContent);

beforeEach(() => {
  mockList.mockReset();
  mockList.mockResolvedValue({
    items: [job("job_a"), job("job_b")],
    total: 2,
    limit: 50,
    offset: 0,
    hasMore: false,
    filters: {},
  });
});

describe("the jobs page", () => {
  it("asks for every job, and shows nothing filtered, at the bare address", async () => {
    render(await pageFor({}));

    expect(mockList).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    expect(rowIds()).toEqual(["job_a", "job_b"]);
    expect(searchBox()).toHaveValue("");
    expect(statusSelect()).toHaveTextContent("All statuses");
    expect(typeSelect()).toHaveTextContent("All types");
  });

  it("asks for only the jobs the address's filters match, and shows them in the controls", async () => {
    mockList.mockResolvedValue({
      items: [job("job_ab1", { status: JobStatus.FAILED })],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
      filters: {},
    });

    render(await pageFor({ search: "job_ab", status: "failed", type: "http" }));

    expect(mockList).toHaveBeenCalledWith({
      search: "job_ab",
      status: JobStatus.FAILED,
      type: JobType.HTTP_REQUEST,
      limit: 50,
      offset: 0,
    });
    expect(rowIds()).toEqual(["job_ab1"]);
    expect(searchBox()).toHaveValue("job_ab");
    expect(statusSelect()).toHaveTextContent("Failed");
    expect(typeSelect()).toHaveTextContent("HTTP");
  });

  it("asks for the jobs a workflow started for the Workflow type", async () => {
    render(await pageFor({ type: "workflow" }));

    expect(mockList).toHaveBeenCalledWith({
      source: "WORKFLOW_STEP",
      limit: 50,
      offset: 0,
    });
    expect(typeSelect()).toHaveTextContent("Workflow");
  });

  it("ignores filters it doesn't know rather than failing, and the controls say so", async () => {
    render(
      await pageFor({
        status: "exploded",
        type: ["cron", "http"],
        page: "2",
        search: `  ${"9".repeat(500)}`,
      }),
    );

    expect(mockList).toHaveBeenCalledWith({
      search: "9".repeat(100),
      limit: 50,
      offset: 0,
    });
    expect(statusSelect()).toHaveTextContent("All statuses");
    expect(typeSelect()).toHaveTextContent("All types");
  });

  it("starts the controls again when the address's filters change, as on Back", async () => {
    const user = userEvent.setup();
    const { rerender } = render(await pageFor({ status: "failed" }));
    await user.type(searchBox(), "typed, not applied");

    // Refresh renders the page again for the same address: what's typed stays.
    rerender(await pageFor({ status: "failed" }));
    expect(searchBox()).toHaveValue("typed, not applied");

    // Back to an address with other filters: the controls show those.
    rerender(await pageFor({ status: "running", search: "17" }));
    expect(searchBox()).toHaveValue("17");
    expect(statusSelect()).toHaveTextContent("Running");
    expect(mockList).toHaveBeenLastCalledWith({
      status: JobStatus.RUNNING,
      search: "17",
      limit: 50,
      offset: 0,
    });
  });
});
