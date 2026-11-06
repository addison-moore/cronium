/**
 * The Tool Action section lists the tool plugins, and those only register once
 * `@/tools/plugins` has been imported. No event page imports that module when it
 * loads, because it brings every plugin's forms and actions with it, so the section
 * has to. It used to read the registry and hope, which only worked after the Tools
 * page had loaded in the same browser session. Opened directly, an event showed "No
 * tools match your search criteria" and none of its settings.
 *
 * These run against the real plugins, on a registry nothing has filled.
 */
import React, { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockImportFails = false;
let mockImports = 0;
const mockSubmit = jest.fn();
const mockChange = jest.fn();
const mockFetchTools = jest.fn();
const mockCreateEvent = jest.fn();
const mockUpdateEvent = jest.fn();

// Jest keeps a module once it has loaded it, so a test can't import this for the first
// time twice. This is each test's first import: what `import()` does in a browser that
// hasn't loaded the plugins yet, which is to register them or to fail.
jest.mock("@/tools/plugins", () => {
  const actual =
    jest.requireActual<typeof import("@/tools/plugins")>("@/tools/plugins");
  return {
    __esModule: true,
    get ToolPluginRegistry() {
      mockImports += 1;
      if (mockImportFails) throw new Error("Loading chunk 123 failed.");
      actual.initializePlugins();
      return actual.ToolPluginRegistry;
    },
  };
});

jest.mock("@/lib/trpc", () => {
  const { useQuery } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  return {
    trpc: {
      events: {
        validateCron: { useQuery: () => ({ data: undefined }) },
        create: { useMutation: () => ({ mutateAsync: mockCreateEvent }) },
        update: { useMutation: () => ({ mutateAsync: mockUpdateEvent }) },
      },
      servers: {
        getAll: { useQuery: () => ({ data: { servers: [] } }) },
        getGroups: { useQuery: () => ({ data: { groups: [] } }) },
      },
      tools: {
        // React Query is real, because which of `data` and `isError` a failure sets, and
        // what a refetch does to them, is what the form has to go by. Only the request
        // is a stub.
        getAll: {
          useQuery: (input: unknown, options?: object) =>
            useQuery({
              queryKey: ["tools.getAll", input],
              queryFn: () => mockFetchTools(input) as Promise<unknown>,
              ...options,
            }),
        },
        executeAction: { useMutation: () => ({ mutate: jest.fn() }) },
      },
      toolActionTemplates: {
        getByToolAction: { useQuery: () => ({ data: undefined }) },
      },
      settings: {
        getEditorSettings: { useQuery: () => ({ data: undefined }) },
        updateEditorSettings: {
          useMutation: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
        },
      },
    },
  };
});

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

import EventForm from "../EventForm";
import ToolActionSection, { type ToolActionConfig } from "../ToolActionSection";
import { ToolPluginRegistry, type ToolPlugin } from "@/tools/types/tool-plugin";
import { EventType, type Tool } from "@/shared/schema";
import { toolQuerySchema } from "@/shared/schemas/tools";

// Loading every plugin for the first time takes seconds on a busy machine.
jest.setTimeout(60_000);
const LOADED = { timeout: 30_000 };

const slackOne = { id: 1, name: "slack-one", type: "SLACK" } as Tool;
const slackTwo = { id: 2, name: "slack-two", type: "SLACK" } as Tool;
const discord = { id: 3, name: "discord", type: "DISCORD" } as Tool;

const STORED: ToolActionConfig = {
  toolType: "SLACK",
  toolId: 1,
  actionId: "slack-send-message",
  parameters: { channel: "#stored", text: "stored text" },
};

/** A credential that isn't in the list any more. */
const GONE: ToolActionConfig = { ...STORED, toolId: 999 };

const REQUIRED = "Tool and action selection is required";

/** The form the section sits in, which is why a plain button in it would submit. */
function Form({
  initial,
  tools = [slackOne],
  isLoadingTools = false,
}: {
  initial: ToolActionConfig | null;
  tools?: Tool[];
  isLoadingTools?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mockSubmit();
      }}
    >
      <ToolActionSection
        value={value}
        onChange={(next) => {
          setValue(next);
          mockChange(next);
        }}
        availableTools={tools}
        isLoadingTools={isLoadingTools}
        toolsLoadFailed={false}
        onRetryTools={jest.fn()}
      />
    </form>
  );
}

/**
 * Everything that reaches the DOM between commits a browser could paint. Text checked
 * only at the start and the end would miss a state that was there for a single frame.
 */
function recordWhatShows() {
  const seen = new Set<string>();
  const look = () => {
    const text = document.body.textContent ?? "";
    if (text.includes("No tools match")) seen.add("no tools match");
    if (text.includes("No tool credentials configured")) {
      seen.add("no credentials");
    }
    if (document.querySelector('input[placeholder="Search tools..."]')) {
      seen.add("the tool picker");
    }
    if (text.includes("Saving keeps that as it is")) {
      seen.add("stored settings notice");
    }
  };
  const observer = new MutationObserver(look);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return {
    seen,
    stop: () => {
      look();
      observer.disconnect();
    },
  };
}

/** The real form on the real React Query, which gives up on the first failure here. */
function renderWithQueries(form: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{form}</QueryClientProvider>);
  return client;
}

/** An existing event in the real form. */
function renderEvent(config: ToolActionConfig | null = STORED) {
  return renderWithQueries(
    <EventForm
      isEditing
      eventId={5}
      initialData={{
        id: 5,
        name: "stored event",
        type: EventType.TOOL_ACTION,
        ...(config && { toolActionConfig: config }),
      }}
    />,
  );
}

/** `/dashboard/events/new` with the type set to Tool Action and a name typed. */
function renderNewEvent(name = "new event") {
  return renderWithQueries(
    <EventForm initialData={{ name, type: EventType.TOOL_ACTION }} />,
  );
}

/** The tool config the one save so far sent, as `events.update` or `events.create` got it. */
function configSentBy(save: jest.Mock): unknown {
  expect(save).toHaveBeenCalledTimes(1);
  const { toolActionConfig } = save.mock.calls[0]?.[0] as {
    toolActionConfig: string;
  };
  return JSON.parse(toolActionConfig);
}

beforeAll(() => {
  // Radix Select's needs, which jsdom doesn't have.
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: jest.fn(),
    hasPointerCapture: jest.fn(() => false),
    setPointerCapture: jest.fn(),
    releasePointerCapture: jest.fn(),
  });
});

beforeEach(() => {
  mockImportFails = false;
  mockImports = 0;
  mockSubmit.mockReset();
  mockChange.mockReset();
  mockCreateEvent.mockReset();
  mockCreateEvent.mockResolvedValue({ id: 6 });
  mockUpdateEvent.mockReset();
  mockUpdateEvent.mockResolvedValue({ id: 5 });
  // What `tools.getAll` does with its input, on the real schema's defaults.
  mockFetchTools.mockReset();
  mockFetchTools.mockImplementation((input: unknown) => {
    const { limit, offset } = toolQuerySchema.parse(input);
    return Promise.resolve({
      tools: [slackOne].slice(offset, offset + limit),
    });
  });
  ToolPluginRegistry.clear();
  global.__pluginsInitialized = undefined;
});

describe("the Tool Action section, opened directly", () => {
  it("shows a stored event's settings", async () => {
    render(<Form initial={STORED} />);

    expect(
      await screen.findByDisplayValue("#stored", {}, LOADED),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("stored text")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Select Credential" }),
    ).toHaveTextContent("slack-one");
    expect(
      screen.getByRole("combobox", { name: "Select Action" }),
    ).toHaveTextContent("Send Message");
    expect(screen.queryByText(/No tools match/)).not.toBeInTheDocument();
  });

  it("goes from loading straight to the settings", async () => {
    const shown = recordWhatShows();
    render(<Form initial={STORED} />);

    // Nothing has had a chance to load: `render` hasn't given up the thread yet.
    expect(screen.getByRole("status")).toHaveTextContent("Loading tools");
    expect(mockImports).toBe(0);

    await screen.findByDisplayValue("#stored", {}, LOADED);
    shown.stop();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect([...shown.seen]).toEqual([]);
  });

  it("offers the tools that have credentials when nothing is stored", async () => {
    const user = userEvent.setup();
    const shown = recordWhatShows();
    render(<Form initial={null} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading tools");
    await user.click(await screen.findByText("Slack", {}, LOADED));
    shown.stop();
    expect([...shown.seen]).toEqual(["the tool picker"]);

    // With one credential it's chosen already, so the action is next.
    expect(
      screen.getByRole("combobox", { name: "Select Credential" }),
    ).toHaveTextContent("slack-one");
    await user.click(screen.getByRole("combobox", { name: "Select Action" }));
    await user.click(
      await screen.findByRole("option", { name: /Send Message/ }),
    );
    await user.type(await screen.findByLabelText("Channel"), "#new");

    expect(mockChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        toolType: "slack",
        toolId: 1,
        actionId: "slack-send-message",
        parameters: expect.objectContaining({
          channel: "#new",
        }) as Record<string, unknown>,
      }),
    );
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("leaves the stored config alone until something changes", async () => {
    const config = {
      ...STORED,
      parameters: { ...STORED.parameters, blocks: '{"blocks":[]}' },
    };
    render(<Form initial={config} />);
    await screen.findByDisplayValue("#stored", {}, LOADED);

    expect(mockChange).not.toHaveBeenCalled();
  });

  it("lets a setting be edited, keeping the others", async () => {
    const user = userEvent.setup();
    render(<Form initial={STORED} />);

    const channel = await screen.findByDisplayValue("#stored", {}, LOADED);
    await user.clear(channel);
    await user.type(channel, "#edited");

    expect(mockChange).toHaveBeenLastCalledWith({
      toolType: "slack",
      toolId: 1,
      actionId: "slack-send-message",
      parameters: { channel: "#edited", text: "stored text" },
    });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("lets the credential be changed, which reaches the saved config", async () => {
    const user = userEvent.setup();
    render(<Form initial={STORED} tools={[slackOne, slackTwo]} />);

    await screen.findByDisplayValue("#stored", {}, LOADED);
    await user.click(
      screen.getByRole("combobox", { name: "Select Credential" }),
    );
    await user.click(await screen.findByRole("option", { name: "slack-two" }));

    expect(mockChange).toHaveBeenLastCalledWith({
      toolType: "slack",
      toolId: 2,
      actionId: "slack-send-message",
      parameters: STORED.parameters,
    });
    expect(
      screen.getByRole("combobox", { name: "Select Credential" }),
    ).toHaveTextContent("slack-two");
    expect(screen.getByDisplayValue("#stored")).toBeInTheDocument();
  });

  it.each([
    ["All", "All"],
    ["a category", /Communication/],
  ])("filters by %s without submitting the form", async (_filter, name) => {
    const user = userEvent.setup();
    render(<Form initial={null} />);

    await screen.findByText("Slack", {}, LOADED);
    await user.click(screen.getByRole("button", { name }));

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it.each(["Test Action", "Clear Selection"])(
    "doesn't submit the form on %s",
    async (name) => {
      const user = userEvent.setup();
      render(<Form initial={STORED} />);

      await screen.findByDisplayValue("#stored", {}, LOADED);
      await user.click(screen.getByRole("button", { name }));

      expect(mockSubmit).not.toHaveBeenCalled();
    },
  );

  it("loads them under StrictMode, which runs the effect twice", async () => {
    render(
      <React.StrictMode>
        <Form initial={STORED} />
      </React.StrictMode>,
    );

    expect(
      await screen.findByDisplayValue("#stored", {}, LOADED),
    ).toBeInTheDocument();
  });

  it("uses plugins already loaded, with nothing to wait for", async () => {
    await jest
      .requireMock<typeof import("@/tools/plugins")>("@/tools/plugins")
      .ToolPluginRegistry.getAll();
    expect(ToolPluginRegistry.getAll().length).toBeGreaterThan(0);
    mockImports = 0;

    render(<Form initial={STORED} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("#stored")).toBeInTheDocument();
    await waitFor(() => expect(mockImports).toBe(0));
  });

  it("waits for the credentials too, rather than saying there are none", async () => {
    const shown = recordWhatShows();
    const { rerender } = render(
      <Form initial={STORED} tools={[]} isLoadingTools />,
    );

    // The plugins are in, and the credentials still aren't.
    await waitFor(() => expect(mockImports).toBe(1), LOADED);
    await waitFor(() =>
      expect(ToolPluginRegistry.getAll().length).toBeGreaterThan(0),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading tools");

    rerender(
      <Form initial={STORED} tools={[slackOne]} isLoadingTools={false} />,
    );
    await screen.findByDisplayValue("#stored");
    shown.stop();

    expect([...shown.seen]).toEqual([]);
  });

  it("says there are no credentials once that's known to be true", async () => {
    render(<Form initial={null} tools={[]} />);

    expect(
      await screen.findByText(/No tool credentials configured/, {}, LOADED),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No tools match/)).not.toBeInTheDocument();
  });

  describe("when the plugins can't be loaded", () => {
    beforeEach(() => {
      mockImportFails = true;
      jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("says so, and that the stored settings are safe", async () => {
      const shown = recordWhatShows();
      render(<Form initial={STORED} />);

      const alert = await screen.findByRole("alert", {}, LOADED);
      shown.stop();

      expect(alert).toHaveTextContent("Couldn't load the tool list");
      expect(alert).toHaveTextContent(/saving keeps them as they are/i);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect([...shown.seen]).toEqual([]);
      expect(mockChange).not.toHaveBeenCalled();
    });

    it("says what can't be done yet when nothing is stored", async () => {
      render(<Form initial={null} />);

      const alert = await screen.findByRole("alert", {}, LOADED);

      expect(alert).toHaveTextContent("Couldn't load the tool list");
      expect(alert).not.toHaveTextContent(/saving keeps/i);
    });

    it("tries again without submitting the form around it", async () => {
      const user = userEvent.setup();
      render(<Form initial={STORED} />);

      const alert = await screen.findByRole("alert", {}, LOADED);
      mockImportFails = false;
      await user.click(
        within(alert).getByRole("button", { name: "Try again" }),
      );

      expect(
        await screen.findByDisplayValue("#stored", {}, LOADED),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Couldn't load the tool list/),
      ).not.toBeInTheDocument();
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it("says so again when trying again fails", async () => {
      const user = userEvent.setup();
      render(<Form initial={STORED} />);

      const alert = await screen.findByRole("alert", {}, LOADED);
      await user.click(
        within(alert).getByRole("button", { name: "Try again" }),
      );

      await waitFor(() => expect(mockImports).toBe(2), LOADED);
      expect(await screen.findByRole("alert", {}, LOADED)).toHaveTextContent(
        "Couldn't load the tool list",
      );
    });
  });
});

describe("when the credentials can't be loaded", () => {
  const FAILED = /Couldn't load your tool credentials/;

  beforeEach(() => {
    mockFetchTools.mockReset();
    mockFetchTools.mockRejectedValue(new Error("Failed to fetch"));
  });

  it("says so, rather than that there are none, and that the stored settings are safe", async () => {
    const shown = recordWhatShows();
    renderEvent();

    const message = await screen.findByText(FAILED, {}, LOADED);
    await screen.findByRole("button", { name: "Try again" });
    shown.stop();

    expect(message).toHaveTextContent(/saving keeps them as they are/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // Not a word about credentials there may be none of, or that may be gone.
    expect([...shown.seen]).toEqual([]);
  });

  it("says what can't be done yet when nothing is stored", async () => {
    renderNewEvent();

    const message = await screen.findByText(FAILED, {}, LOADED);

    expect(message).toHaveTextContent(/can't be set up/);
    expect(message).not.toHaveTextContent(/saving keeps/i);
  });

  it("keeps the stored settings through a save", async () => {
    const user = userEvent.setup();
    renderEvent();

    await screen.findByText(FAILED, {}, LOADED);
    await user.click(screen.getByRole("button", { name: "Update Event" }));

    await waitFor(() => expect(mockUpdateEvent).toHaveBeenCalled());
    expect(configSentBy(mockUpdateEvent)).toEqual(STORED);
  });

  it("tries again, without submitting the form around it, and shows the settings", async () => {
    const user = userEvent.setup();
    renderEvent();

    const again = await screen.findByRole(
      "button",
      { name: "Try again" },
      LOADED,
    );
    expect(mockFetchTools).toHaveBeenCalledTimes(1);
    mockFetchTools.mockReset();
    mockFetchTools.mockResolvedValue({ tools: [slackOne] });
    await user.click(again);

    expect(
      await screen.findByDisplayValue("#stored", {}, LOADED),
    ).toBeInTheDocument();
    expect(mockFetchTools).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it("says it's loading while it tries again, and so again when that fails", async () => {
    const user = userEvent.setup();
    renderEvent();

    const again = await screen.findByRole(
      "button",
      { name: "Try again" },
      LOADED,
    );
    let answer: (reason: Error) => void = () => undefined;
    mockFetchTools.mockReset();
    mockFetchTools.mockReturnValue(
      new Promise((_resolve, reject) => {
        answer = reject;
      }),
    );
    await user.click(again);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Loading tools",
    );
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();

    answer(new Error("Failed to fetch"));

    expect(await screen.findByText(FAILED, {}, LOADED)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the settings once a later fetch brings the credentials, on its own", async () => {
    const client = renderEvent();

    await screen.findByText(FAILED, {}, LOADED);
    mockFetchTools.mockReset();
    mockFetchTools.mockResolvedValue({ tools: [slackOne] });
    await client.refetchQueries({ queryKey: ["tools.getAll"] });

    expect(
      await screen.findByDisplayValue("#stored", {}, LOADED),
    ).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
  });

  it("tries the plugins again too when neither has loaded", async () => {
    const user = userEvent.setup();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockImportFails = true;
    renderEvent();

    await screen.findByText(/Couldn't load the tool list/, {}, LOADED);
    await waitFor(() => expect(mockFetchTools).toHaveBeenCalledTimes(1));
    mockImportFails = false;
    mockFetchTools.mockReset();
    mockFetchTools.mockResolvedValue({ tools: [slackOne] });
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByDisplayValue("#stored", {}, LOADED),
    ).toBeInTheDocument();
    jest.restoreAllMocks();
  });
});

describe("when a background refetch of the credentials fails", () => {
  it("keeps showing the settings, because it still has the answer it had", async () => {
    const client = renderEvent();
    await screen.findByDisplayValue("#stored", {}, LOADED);
    const shown = recordWhatShows();

    mockFetchTools.mockReset();
    mockFetchTools.mockRejectedValue(new Error("Failed to fetch"));
    await client.refetchQueries({ queryKey: ["tools.getAll"] });
    await waitFor(() =>
      expect(
        client.getQueryCache().findAll({ queryKey: ["tools.getAll"] })[0]?.state
          .status,
      ).toBe("error"),
    );
    // React Query tells the page about an answer with a timer.
    await new Promise((resolve) => setTimeout(resolve, 50));
    shown.stop();

    expect(screen.getByDisplayValue("#stored")).toBeInTheDocument();
    expect(
      screen.queryByText(/Couldn't load your tool credentials/),
    ).not.toBeInTheDocument();
    expect([...shown.seen]).toEqual([]);
  });
});

describe("an event whose credential has been deleted", () => {
  async function findNotice() {
    const line = await screen.findByText(
      /This event's credential is gone/,
      {},
      LOADED,
    );
    return line.closest('[role="alert"]') as HTMLElement;
  }

  it("says so, what's stored, and that a save keeps it", async () => {
    render(<Form initial={GONE} />);

    const notice = await findNotice();

    expect(notice).toHaveTextContent("Send Message");
    expect(notice).toHaveTextContent("Slack");
    expect(notice).toHaveTextContent(/saving keeps/i);
    expect(notice).toHaveTextContent(/its runs will fail/);
    expect(mockChange).not.toHaveBeenCalled();
    // The picker is still there to replace it with.
    expect(screen.getByRole("heading", { name: "Slack" })).toBeInTheDocument();
  });

  it("doesn't say so before the credentials have answered", async () => {
    const shown = recordWhatShows();
    const { rerender } = render(
      <Form initial={GONE} tools={[]} isLoadingTools />,
    );

    await waitFor(() => expect(mockImports).toBe(1), LOADED);
    await waitFor(() =>
      expect(ToolPluginRegistry.getAll().length).toBeGreaterThan(0),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading tools");
    expect([...shown.seen]).toEqual([]);

    rerender(<Form initial={GONE} tools={[slackOne]} />);
    await findNotice();
    shown.stop();
  });

  it("names a tool or action with no plugin the way they're stored", async () => {
    render(
      <Form
        initial={{
          toolType: "PAGERDUTY",
          toolId: 999,
          actionId: "page-someone",
          parameters: {},
        }}
      />,
    );

    const notice = await findNotice();

    expect(notice).toHaveTextContent("PAGERDUTY");
    expect(notice).toHaveTextContent("page-someone");
  });

  it("doesn't break on a row that leaves the tool out", async () => {
    render(
      <Form
        initial={
          { toolId: 999, actionId: "old-action", parameters: {} } as never
        }
      />,
    );

    const notice = await findNotice();

    expect(notice).toHaveTextContent("an unknown tool");
    expect(notice).toHaveTextContent("old-action");
  });

  it("names an action the plugin doesn't have the way it's stored", async () => {
    render(<Form initial={{ ...GONE, actionId: "old-action" }} />);

    const notice = await findNotice();

    expect(notice).toHaveTextContent("Slack");
    expect(notice).toHaveTextContent("old-action");
  });

  it("promises nothing about a config a save would refuse", async () => {
    render(
      <Form
        initial={{ toolType: "SLACK", toolId: 999, parameters: {} } as never}
      />,
    );

    await screen.findByRole("heading", { name: "Slack" }, LOADED);

    expect(screen.queryByText(/credential is gone/)).not.toBeInTheDocument();
  });

  it("is replaced by choosing a tool, which clears it from what a save sends", async () => {
    const user = userEvent.setup();
    render(<Form initial={GONE} />);

    await findNotice();
    await user.click(screen.getByRole("heading", { name: "Slack" }));

    expect(mockChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText(/credential is gone/)).not.toBeInTheDocument();
    expect(mockSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("combobox", { name: "Select Action" }));
    await user.click(
      await screen.findByRole("option", { name: /Send Message/ }),
    );

    expect(mockChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        toolType: "slack",
        toolId: 1,
        actionId: "slack-send-message",
      }),
    );
    expect(screen.queryByText(/credential is gone/)).not.toBeInTheDocument();
  });

  it("says so beside the message about having no credentials at all", async () => {
    render(<Form initial={GONE} tools={[]} />);

    await findNotice();

    expect(
      screen.getByText(/No tool credentials configured/),
    ).toBeInTheDocument();
  });

  it("says so if it's deleted while the settings are showing, and a credential replaces it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Form initial={STORED} tools={[slackOne, slackTwo]} />,
    );
    await screen.findByDisplayValue("#stored", {}, LOADED);
    expect(screen.queryByText(/credential is gone/)).not.toBeInTheDocument();

    rerender(<Form initial={STORED} tools={[slackTwo]} />);

    await findNotice();
    expect(screen.getByDisplayValue("#stored")).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "Select Credential" }),
    );
    await user.click(await screen.findByRole("option", { name: "slack-two" }));

    expect(screen.queryByText(/credential is gone/)).not.toBeInTheDocument();
    expect(mockChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ toolId: 2, parameters: STORED.parameters }),
    );
  });

  it("keeps the config through a save of the real form", async () => {
    const user = userEvent.setup();
    renderEvent(GONE);

    await findNotice();
    await user.click(screen.getByRole("button", { name: "Update Event" }));

    await waitFor(() => expect(mockUpdateEvent).toHaveBeenCalled());
    expect(configSentBy(mockUpdateEvent)).toEqual(GONE);
  });

  it("isn't said of a credential past the server's first page", async () => {
    // `tools.getAll` answers with 20 unless it's asked for more.
    const many = Array.from(
      { length: 25 },
      (_, index) =>
        ({ id: 100 + index, name: `slack-${index}`, type: "SLACK" }) as Tool,
    );
    mockFetchTools.mockImplementation((input: unknown) => {
      const { limit, offset } = toolQuerySchema.parse(input);
      return Promise.resolve({ tools: many.slice(offset, offset + limit) });
    });

    renderEvent({ ...STORED, toolId: 124 });

    expect(
      await screen.findByDisplayValue("#stored", {}, LOADED),
    ).toBeInTheDocument();
    expect(screen.queryByText(/credential is gone/)).not.toBeInTheDocument();
  });
});

describe("an event whose action or tool isn't there any more", () => {
  const STALE: ToolActionConfig = { ...STORED, actionId: "send-message" };
  const NO_PLUGIN: ToolActionConfig = {
    toolType: "WEBHOOK",
    toolId: 9,
    actionId: "send-request",
    parameters: { url: "https://example.test" },
  };
  const webhook = { id: 9, name: "old-webhook", type: "WEBHOOK" } as Tool;

  async function findNotice() {
    const line = await screen.findByText(
      "This event's action isn't available.",
      {},
      LOADED,
    );
    return line.closest('[role="alert"]') as HTMLElement;
  }

  it("says so of an action the tool doesn't have, and that a save keeps it", async () => {
    render(<Form initial={STALE} />);

    const notice = await findNotice();

    expect(notice).toHaveTextContent("send-message");
    expect(notice).toHaveTextContent("Slack");
    expect(notice).toHaveTextContent(/saving keeps/i);
    // A run looks actions up by id alone, so it might not fail. It's not said to.
    expect(notice).not.toHaveTextContent(/fail/);
    expect(mockChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("combobox", { name: "Select Credential" }),
    ).toHaveTextContent("slack-one");
  });

  it("goes once an action is chosen", async () => {
    const user = userEvent.setup();
    render(<Form initial={STALE} />);

    await findNotice();
    await user.click(screen.getByRole("combobox", { name: "Select Action" }));
    await user.click(
      await screen.findByRole("option", { name: /Send Message/ }),
    );

    expect(screen.queryByText(/isn't available/)).not.toBeInTheDocument();
    expect(mockChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ actionId: "slack-send-message" }),
    );
  });

  it("says so of a credential whose tool has no plugin", async () => {
    render(<Form initial={NO_PLUGIN} tools={[webhook, slackOne]} />);

    const notice = await findNotice();

    expect(notice).toHaveTextContent("WEBHOOK");
    expect(notice).toHaveTextContent("send-request");
    expect(screen.getByRole("heading", { name: "Slack" })).toBeInTheDocument();
  });

  it("isn't said of an event that shows", async () => {
    const shown = recordWhatShows();
    render(<Form initial={STORED} />);

    await screen.findByDisplayValue("#stored", {}, LOADED);
    shown.stop();

    expect(screen.queryByText(/isn't available/)).not.toBeInTheDocument();
    expect([...shown.seen]).toEqual([]);
  });

  it("keeps the config through a save of the real form", async () => {
    const user = userEvent.setup();
    renderEvent(STALE);

    await findNotice();
    await user.click(screen.getByRole("button", { name: "Update Event" }));

    await waitFor(() => expect(mockUpdateEvent).toHaveBeenCalled());
    expect(configSentBy(mockUpdateEvent)).toEqual(STALE);
  });
});

describe("a save with no tool chosen", () => {
  it("says why on a new event, where nothing goes out", async () => {
    const user = userEvent.setup();
    renderNewEvent();

    await screen.findByRole("heading", { name: "Slack" }, LOADED);
    await user.click(screen.getByRole("button", { name: "Create Event" }));

    expect(await screen.findByText(REQUIRED)).toBeInTheDocument();
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("says why after Clear Selection on an existing event", async () => {
    const user = userEvent.setup();
    renderEvent();

    await screen.findByDisplayValue("#stored", {}, LOADED);
    await user.click(screen.getByRole("button", { name: "Clear Selection" }));
    await user.click(screen.getByRole("button", { name: "Update Event" }));

    expect(await screen.findByText(REQUIRED)).toBeInTheDocument();
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it("takes the focus, on every press, which brings the message into view", async () => {
    const user = userEvent.setup();
    renderNewEvent();

    await screen.findByRole("heading", { name: "Slack" }, LOADED);
    await user.click(screen.getByRole("button", { name: "Create Event" }));

    const message = await screen.findByText(REQUIRED);
    const target = message.closest("[tabindex]");
    await waitFor(() => expect(target).toHaveFocus());

    await user.click(screen.getByRole("textbox", { name: /Event Name/ }));
    expect(target).not.toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Create Event" }));

    await waitFor(() => expect(target).toHaveFocus());
  });

  it("is announced, as the other alerts are", async () => {
    const user = userEvent.setup();
    renderNewEvent();

    await screen.findByRole("heading", { name: "Slack" }, LOADED);
    await user.click(screen.getByRole("button", { name: "Create Event" }));

    const message = await screen.findByText(REQUIRED);
    expect(message.closest('[role="alert"]')).toBeInTheDocument();
  });

  it("gives way to the first field with a problem, and says both", async () => {
    const user = userEvent.setup();
    renderNewEvent("");

    await screen.findByRole("heading", { name: "Slack" }, LOADED);
    await user.click(screen.getByRole("button", { name: "Create Event" }));

    expect(await screen.findByText(REQUIRED)).toBeInTheDocument();
    expect(screen.getByText("Event name is required")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /Event Name/ })).toHaveFocus(),
    );
  });

  it("goes when a tool and an action are chosen, and the save then goes out", async () => {
    const user = userEvent.setup();
    renderNewEvent();

    await screen.findByRole("heading", { name: "Slack" }, LOADED);
    await user.click(screen.getByRole("button", { name: "Create Event" }));
    await screen.findByText(REQUIRED);

    // Choosing the tool isn't enough for a save, so the message is still true.
    await user.click(screen.getByRole("heading", { name: "Slack" }));
    expect(screen.getByText(REQUIRED)).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Select Action" }));
    await user.click(
      await screen.findByRole("option", { name: /Send Message/ }),
    );

    await waitFor(() =>
      expect(screen.queryByText(REQUIRED)).not.toBeInTheDocument(),
    );
    await user.type(await screen.findByLabelText("Channel"), "#new");
    await user.type(screen.getByLabelText(/^Text/), "new text");
    await user.click(screen.getByRole("button", { name: "Create Event" }));

    await waitFor(() => expect(mockCreateEvent).toHaveBeenCalled());
    expect(configSentBy(mockCreateEvent)).toEqual(
      expect.objectContaining({
        toolId: 1,
        actionId: "slack-send-message",
      }),
    );
  });

  it("isn't there before a save has been tried", async () => {
    const user = userEvent.setup();
    renderEvent();

    await screen.findByDisplayValue("#stored", {}, LOADED);
    await user.click(screen.getByRole("button", { name: "Clear Selection" }));

    expect(screen.queryByText(REQUIRED)).not.toBeInTheDocument();
  });

  it("says why when the credentials couldn't be loaded either", async () => {
    const user = userEvent.setup();
    mockFetchTools.mockReset();
    mockFetchTools.mockRejectedValue(new Error("Failed to fetch"));
    renderNewEvent();

    await screen.findByRole("button", { name: "Try again" }, LOADED);
    await user.click(screen.getByRole("button", { name: "Create Event" }));

    expect(await screen.findByText(REQUIRED)).toBeInTheDocument();
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });
});

describe("the picker's wording", () => {
  const credentialsOf = (...types: string[]) =>
    types.map((type, index) => ({ id: index + 1, name: type, type }) as Tool);

  it.each(["Communication", "Productivity", "Data", "AI"])(
    "names the %s filter, with an icon rather than an icon's name",
    async (name) => {
      render(
        <Form
          initial={null}
          tools={credentialsOf("EMAIL", "SLACK", "NOTION", "SQL", "AI")}
        />,
      );

      await screen.findByRole("heading", { name: "Slack" }, LOADED);
      const filter = screen.getByRole("button", { name });

      expect(filter).toHaveTextContent(new RegExp(`^${name}$`));
      expect(filter.querySelector("svg")).toBeInTheDocument();
    },
  );

  it("uses an icon a plugin gives as an element", () => {
    // Slack's looks just like its category's default, so this one needs its own.
    ToolPluginRegistry.register({
      id: "custom",
      name: "Custom",
      icon: () => null,
      category: "Custom",
      categoryIcon: <svg data-testid="its-own-icon" />,
      actions: [],
    } as unknown as ToolPlugin);

    render(<Form initial={null} tools={credentialsOf("CUSTOM")} />);

    expect(
      within(screen.getByRole("button", { name: "Custom" })).getByTestId(
        "its-own-icon",
      ),
    ).toBeInTheDocument();
  });

  it("counts one action as one", async () => {
    render(<Form initial={null} tools={credentialsOf("SLACK")} />);

    await screen.findByRole("heading", { name: "Slack" }, LOADED);

    expect(screen.getByText("1 action")).toBeInTheDocument();
    expect(screen.queryByText("1 actions")).not.toBeInTheDocument();
  });

  it("counts several as several", async () => {
    render(<Form initial={null} tools={credentialsOf("GOOGLE-SHEETS")} />);

    await screen.findByRole("heading", { name: "Google Sheets" }, LOADED);
    const count = ToolPluginRegistry.get("google-sheets")?.actions?.length;

    expect(count).toBeGreaterThan(1);
    expect(screen.getByText(`${count} actions`)).toBeInTheDocument();
  });
});

describe("the live preview", () => {
  const DISCORD: ToolActionConfig = {
    toolType: "DISCORD",
    toolId: 3,
    actionId: "discord-send-message",
    parameters: { content: "stored discord text" },
  };

  it("shows a Slack message, and follows what's typed", async () => {
    const user = userEvent.setup();
    render(<Form initial={STORED} />);

    const text = await screen.findByDisplayValue("stored text", {}, LOADED);
    const preview = screen.getByText("Slack Message Preview").closest("div")
      ?.parentElement as HTMLElement;

    expect(preview).toHaveTextContent("stored");
    expect(preview).toHaveTextContent("stored text");

    await user.clear(text);
    await user.type(text, "typed text");

    expect(preview).toHaveTextContent("typed text");
  });

  it("doesn't make up a channel for a message with no channel", async () => {
    render(
      <Form initial={{ ...STORED, parameters: { text: "no channel set" } }} />,
    );

    await screen.findByDisplayValue("no channel set", {}, LOADED);

    expect(screen.getByText("Slack Message Preview")).toBeInTheDocument();
    expect(screen.queryByText("general")).not.toBeInTheDocument();
    expect(screen.getByText("The webhook's channel")).toBeInTheDocument();
  });

  it("shows a Discord message as Discord's, with no channel made up", async () => {
    render(<Form initial={DISCORD} tools={[discord]} />);

    await screen.findByDisplayValue("stored discord text", {}, LOADED);

    expect(screen.getByText("Discord Message Preview")).toBeInTheDocument();
    expect(screen.queryByText("Slack Message Preview")).not.toBeInTheDocument();
    expect(screen.queryByText("general")).not.toBeInTheDocument();
    expect(screen.getByText("The webhook's channel")).toBeInTheDocument();
  });

  it("loads an avatar from the address given, not through Next's image optimizer", async () => {
    // No host is allowed there, so it answers 400, and `next dev` throws while rendering.
    render(
      <Form
        initial={{
          ...DISCORD,
          parameters: {
            content: "with avatar",
            username: "Ops Bot",
            avatar_url: "https://cdn.example.test/avatar.png",
          },
        }}
        tools={[discord]}
      />,
    );

    await screen.findByDisplayValue("with avatar", {}, LOADED);

    expect(screen.getByRole("img", { name: "Ops Bot" })).toHaveAttribute(
      "src",
      "https://cdn.example.test/avatar.png",
    );
  });

  it.each([
    "htt",
    // `next/image` throws on this one outside production, taking the page with it.
    "https://",
    "/relative.png",
    "http://cdn.example.test/avatar.png",
  ])("has no image for %s, which the page couldn't load", async (avatar) => {
    render(
      <Form
        initial={{
          ...DISCORD,
          parameters: {
            content: "with avatar",
            username: "Ops Bot",
            avatar_url: avatar,
          },
        }}
        tools={[discord]}
      />,
    );

    await screen.findByDisplayValue("with avatar", {}, LOADED);

    expect(
      screen.queryByRole("img", { name: "Ops Bot" }),
    ).not.toBeInTheDocument();
  });

  it("still shows an email's", async () => {
    render(
      <Form
        initial={{
          toolType: "EMAIL",
          toolId: 4,
          actionId: "send-email",
          parameters: { to: "a@example.test", subject: "Stored", body: "Body" },
        }}
        tools={[{ id: 4, name: "email", type: "EMAIL" } as Tool]}
      />,
    );

    await screen.findByDisplayValue("Stored", {}, LOADED);

    expect(screen.getByText("Email Preview")).toBeInTheDocument();
  });
});

describe("the event form", () => {
  it("doesn't load the plugins for an event that isn't a tool action", async () => {
    renderWithQueries(
      <EventForm
        initialData={{ type: EventType.BASH, content: "echo hello" }}
      />,
    );
    await screen.findByRole("button", { name: "Create Event" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockImports).toBe(0);
    expect(ToolPluginRegistry.getAll()).toEqual([]);
  });

  it("loads them once the type is changed to Tool Action", async () => {
    const user = userEvent.setup();
    renderWithQueries(
      <EventForm
        initialData={{ type: EventType.BASH, content: "echo hello" }}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Event Type" }));
    await user.click(
      await screen.findByRole("option", { name: "Tool Action" }),
    );

    expect(await screen.findByText("Slack", {}, LOADED)).toBeInTheDocument();
    expect(screen.queryByText(/No tools match/)).not.toBeInTheDocument();
  });
});
