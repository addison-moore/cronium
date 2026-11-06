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

let mockImportFails = false;
let mockImports = 0;
const mockSubmit = jest.fn();
const mockChange = jest.fn();

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

jest.mock("@/lib/trpc", () => ({
  trpc: {
    events: {
      validateCron: { useQuery: () => ({ data: undefined }) },
      create: { useMutation: () => ({ mutateAsync: jest.fn() }) },
      update: { useMutation: () => ({ mutateAsync: jest.fn() }) },
    },
    servers: {
      getAll: { useQuery: () => ({ data: { servers: [] } }) },
      getGroups: { useQuery: () => ({ data: { groups: [] } }) },
    },
    tools: {
      getAll: {
        useQuery: () => ({ data: { tools: [{ id: 1, type: "SLACK" }] } }),
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

import EventForm from "../EventForm";
import ToolActionSection, { type ToolActionConfig } from "../ToolActionSection";
import { ToolPluginRegistry } from "@/tools/types/tool-plugin";
import { EventType, type Tool } from "@/shared/schema";

// Loading every plugin for the first time takes seconds on a busy machine.
jest.setTimeout(60_000);
const LOADED = { timeout: 30_000 };

const slackOne = { id: 1, name: "slack-one", type: "SLACK" } as Tool;
const slackTwo = { id: 2, name: "slack-two", type: "SLACK" } as Tool;

const STORED: ToolActionConfig = {
  toolType: "SLACK",
  toolId: 1,
  actionId: "slack-send-message",
  parameters: { channel: "#stored", text: "stored text" },
};

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

describe("the event form", () => {
  it("doesn't load the plugins for an event that isn't a tool action", async () => {
    render(
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
    render(
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
