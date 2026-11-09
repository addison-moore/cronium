/**
 * The section's button used to say "Test Action", and its toast "Action executed
 * successfully in test mode", whatever the action was and however it went. Only Notion,
 * Google Sheets, Teams and Trello read `isTest`. A press really posted to Slack, really
 * deleted rows and documents, and said "Test Successful" when the host didn't exist.
 *
 * These run against the real plugins and the real React Query, so what the button and the
 * toast say comes from what each action really declares. `src/tools/__tests__/test-run.test.ts`
 * checks those declarations against what the actions do.
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockExecute = jest.fn<Promise<unknown>, [unknown]>();
const mockToast = jest.fn();
const mockSubmit = jest.fn();

jest.mock("@/lib/trpc", () => {
  const { useMutation } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  return {
    trpc: {
      tools: {
        executeAction: {
          useMutation: (options: object) =>
            useMutation({
              mutationFn: (input: unknown) => mockExecute(input),
              ...options,
            }),
        },
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
    useToast: () => ({ toast: mockToast }),
    MonacoEditor: ({ value }: { value?: string }) =>
      ReactActual.createElement("textarea", {
        readOnly: true,
        value: value ?? "",
      }),
  };
});

import ToolActionSection, { type ToolActionConfig } from "../ToolActionSection";
import { initializePlugins } from "@/tools/plugins";
import type { Tool } from "@/shared/schema";

// Loading every plugin for the first time takes seconds on a busy machine.
jest.setTimeout(60_000);

const NO_TEST_MODE = "There's no test mode: this really";
const SLACK_LINE = `${NO_TEST_MODE} posts to Slack.`;
const WRITES_LINE = `${NO_TEST_MODE} changes your data, and can't be undone.`;
const READS_LINE = "Really runs on this database, read-only.";
// An action with a check has a test mode, so its question says only what's real.
const CHECKED_WRITES_LINE =
  "This really changes your data, and can't be undone.";
const simulatedLine = (service: string) =>
  `Checks the parameters only. Nothing goes to ${service}, so this doesn't show that the credential works.`;

const credential = (type: string) =>
  ({ id: 1, name: `my-${type.toLowerCase()}`, type }) as Tool;

const config = (
  type: string,
  actionId: string,
  parameters: Record<string, unknown> = {},
): ToolActionConfig => ({
  toolType: type,
  toolId: 1,
  actionId,
  parameters,
});

const SLACK = config("SLACK", "slack-send-message", {
  channel: "#ops",
  text: "hello",
});
const TRELLO = config("TRELLO", "create-card", { listId: "l", name: "n" });
const RUN_QUERY = config("SQL", "run-query", { query: "SELECT 1" });
const EXECUTE = config("SQL", "execute-statement", {
  statement: "DELETE FROM orders",
});
const DELETE = config("MONGODB", "delete-documents", {
  collection: "orders",
  filter: '{"_id":1}',
});
const UPDATE = config("MONGODB", "update-documents", {
  collection: "orders",
  filter: '{"status":"open"}',
  update: '{"$set":{"status":"done"}}',
});
const EMAIL = config("EMAIL", "send-email", {
  to: "a@example.test",
  subject: "s",
  body: "b",
});
const DISCORD = config("DISCORD", "discord-send-message", { content: "hi" });
const PROMPT = config("AI", "ai-prompt", { userPrompt: "hi" });

/** What the form sends for each kind of press. */
const asked = (
  value: ToolActionConfig,
  mode: "simulate" | "check" | "run",
) => ({
  toolId: 1,
  actionId: value.actionId,
  parameters: value.parameters,
  mode,
  // A server from before `mode` goes by this alone.
  isTest: mode !== "run",
});

/** The form the section sits in, which is why a plain button in it would submit. */
function section(value: ToolActionConfig) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mockSubmit();
      }}
    >
      <ToolActionSection
        value={value}
        onChange={jest.fn()}
        availableTools={[credential(value.toolType)]}
        isLoadingTools={false}
        toolsLoadFailed={false}
        onRetryTools={jest.fn()}
      />
    </form>
  );
}

const client = () =>
  new QueryClient({ defaultOptions: { mutations: { retry: false } } });

function renderSection(value: ToolActionConfig) {
  const queries = client();
  const view = render(
    <QueryClientProvider client={queries}>
      {section(value)}
    </QueryClientProvider>,
  );
  return {
    ...view,
    show: (next: ToolActionConfig) =>
      view.rerender(
        <QueryClientProvider client={queries}>
          {section(next)}
        </QueryClientProvider>,
      ),
  };
}

const pressed = (name: string) => screen.getByRole("button", { name });

/** A promise this test settles itself, for what happens during a run. */
function answerLater() {
  let answer!: (value: unknown) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<unknown>((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  mockExecute.mockReturnValue(promise);
  return { answer, fail };
}

/** A press, with the question if there is one answered yes. */
async function run(user: ReturnType<typeof userEvent.setup>, button: string) {
  await user.click(pressed(button));
  const dialog = screen.queryByRole("alertdialog");
  if (dialog) {
    await user.click(
      within(dialog).getByRole("button", { name: button.replace(" Now", "") }),
    );
  }
}

beforeAll(() => initializePlugins());

beforeEach(() => {
  mockExecute.mockReset();
  mockExecute.mockResolvedValue({ success: true, result: {} });
  mockToast.mockClear();
  mockSubmit.mockClear();
});

describe("the button says what it will do", () => {
  it.each<[string, string, string, string]>([
    ["SLACK", "slack-send-message", "Send Message Now", SLACK_LINE],
    [
      "AI",
      "ai-prompt",
      "Prompt LLM Now",
      `${NO_TEST_MODE} sends the prompt to the model, and your provider may charge for it.`,
    ],
    ["SQL", "run-query", "Run Query Now", READS_LINE],
    ["SQL", "execute-statement", "Execute Statement Now", WRITES_LINE],
    ["MONGODB", "find-documents", "Find Documents Now", READS_LINE],
    ["MONGODB", "aggregate-documents", "Aggregate Documents Now", READS_LINE],
    ["MONGODB", "insert-documents", "Insert Documents Now", WRITES_LINE],
    ["NOTION", "create-page", "Simulate", simulatedLine("Notion")],
    ["NOTION", "search-content", "Simulate", simulatedLine("Notion")],
    ["NOTION", "update-database", "Simulate", simulatedLine("Notion")],
    ["NOTION", "manage-blocks", "Simulate", simulatedLine("Notion")],
    ["GOOGLE-SHEETS", "read-data", "Simulate", simulatedLine("Google Sheets")],
    ["GOOGLE-SHEETS", "write-data", "Simulate", simulatedLine("Google Sheets")],
    [
      "GOOGLE-SHEETS",
      "create-sheet",
      "Simulate",
      simulatedLine("Google Sheets"),
    ],
    ["TEAMS", "send-message", "Simulate", simulatedLine("Microsoft Teams")],
    ["TEAMS", "send-card", "Simulate", simulatedLine("Microsoft Teams")],
    ["TRELLO", "create-card", "Simulate", simulatedLine("Trello")],
    ["TRELLO", "move-card", "Simulate", simulatedLine("Trello")],
    ["TRELLO", "add-checklist", "Simulate", simulatedLine("Trello")],
  ])("%s %s: %s", (type, actionId, button, line) => {
    renderSection(config(type, actionId));

    expect(pressed(button)).toHaveAccessibleDescription(line);
    expect(screen.getByText(line)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Test Action" }),
    ).not.toBeInTheDocument();
    // Nothing stops these short of the real thing, so there's nothing to offer.
    expect(
      screen.queryByRole("button", {
        name: /^(Count Matches|Check Login|Check Webhook)$/,
      }),
    ).not.toBeInTheDocument();
  });
});

const COUNT_DELETE_LINE =
  "Count Matches says how many documents the filter matches, and deletes nothing.";

describe("an action with a check offers it beside the real run", () => {
  it.each<[string, ToolActionConfig, string, string, string, string]>([
    [
      "a MongoDB delete",
      DELETE,
      "Count Matches",
      COUNT_DELETE_LINE,
      "Delete Documents Now",
      "Delete Documents Now really changes your data, and can't be undone.",
    ],
    [
      "a MongoDB update",
      UPDATE,
      "Count Matches",
      "Count Matches says how many documents the filter matches, and changes nothing. It doesn't try the update.",
      "Update Documents Now",
      "Update Documents Now really changes your data, and can't be undone.",
    ],
    [
      "an email",
      EMAIL,
      "Check Login",
      "Check Login signs in to the mail server, and sends nothing.",
      "Send Email Now",
      "Send Email Now really sends the email.",
    ],
    [
      "a Discord message",
      DISCORD,
      "Check Webhook",
      "Check Webhook asks Discord whether the webhook exists, and posts nothing.",
      "Send Message Now",
      "Send Message Now really posts to Discord.",
    ],
  ])(
    "%s, with a line for each button",
    (_, value, check, checkLine, button, buttonLine) => {
      renderSection(value);

      expect(pressed(check)).toHaveAccessibleDescription(checkLine);
      expect(pressed(button)).toHaveAccessibleDescription(buttonLine);
      expect(screen.getByText(checkLine)).toBeVisible();
      expect(screen.getByText(buttonLine)).toBeVisible();
      expect(screen.queryByText(/no test mode/)).not.toBeInTheDocument();
    },
  );

  it("checks straight away, asking for a check, with nothing to confirm", async () => {
    const user = userEvent.setup();
    renderSection(DELETE);

    await user.click(pressed("Count Matches"));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mockExecute).toHaveBeenCalledWith(asked(DELETE, "check")),
    );
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("still asks before the real run, and asks for the real run", async () => {
    const user = userEvent.setup();
    renderSection(DELETE);

    await user.click(pressed("Delete Documents Now"));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      `${CHECKED_WRITES_LINE} It uses the credential my-mongodb.`,
    );
    expect(dialog).not.toHaveTextContent(/no test mode/);
    expect(mockExecute).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: "Delete Documents" }),
    );

    await waitFor(() =>
      expect(mockExecute).toHaveBeenCalledWith(asked(DELETE, "run")),
    );
  });

  it("can't be pressed again, either way, while a check runs", async () => {
    const user = userEvent.setup();
    const { answer } = answerLater();
    renderSection(EMAIL);

    await user.click(pressed("Check Login"));
    await waitFor(() => expect(pressed("Check Login")).toBeDisabled());
    expect(pressed("Send Email Now")).toBeDisabled();
    await user.click(pressed("Check Login"));
    expect(mockExecute).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer({
        success: true,
        checked: true,
        result: { host: "smtp.example.test", signedIn: true },
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(pressed("Check Login")).toBeEnabled());
    expect(pressed("Send Email Now")).toBeEnabled();
  });

  it.each<[string, ToolActionConfig, string, unknown, string]>([
    [
      "a delete without Many",
      DELETE,
      "Count Matches",
      { matchedCount: 3, many: false },
      "3 documents match the filter, but without Many only the first would be deleted. Nothing was deleted, so this doesn't show that the delete would be allowed.",
    ],
    [
      "an update with Upsert",
      UPDATE,
      "Count Matches",
      { matchedCount: 0, many: false, upsert: true },
      "No documents match the filter, so Upsert would add one. Nothing was changed, so this doesn't show that the update would be accepted.",
    ],
    [
      "an email",
      EMAIL,
      "Check Login",
      { host: "smtp.example.test", signedIn: true },
      "smtp.example.test accepted the login. Nothing was sent, so this doesn't show that the email would be delivered.",
    ],
    [
      "a Discord message",
      DISCORD,
      "Check Webhook",
      { webhookName: "Cronium Alerts" },
      "The webhook Cronium Alerts exists. Nothing was posted, so this doesn't show that Discord would accept the message.",
    ],
  ])(
    "says what a check of %s showed, and what it didn't",
    async (_, value, check, result, description) => {
      const user = userEvent.setup();
      mockExecute.mockResolvedValue({ success: true, checked: true, result });
      renderSection(value);

      await user.click(pressed(check));

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: "Checked",
          description,
        }),
      );
      expect(mockToast).toHaveBeenCalledTimes(1);
    },
  );

  // Only a server that doesn't know the check would do this, and then it really deleted.
  it("says what really happened when a check came back as a real run", async () => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue({
      success: true,
      checked: false,
      result: { deletedCount: 1 },
    });
    renderSection(DELETE);

    await user.click(pressed("Count Matches"));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Done",
        description: "Deleted 1 document.",
      }),
    );
  });

  it.each<[string, () => void, string]>([
    [
      "the database said no",
      () =>
        mockExecute.mockResolvedValue({
          success: false,
          error: "not authorized on shop to execute command",
        }),
      "not authorized on shop to execute command",
    ],
    [
      "no answer came back",
      () => mockExecute.mockRejectedValue({ message: "Failed to fetch" }),
      "Failed to fetch",
    ],
    [
      "the server broke",
      () =>
        mockExecute.mockRejectedValue({
          message: "An internal error occurred",
          data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
        }),
      "An internal error occurred",
    ],
  ])(
    "says a check failed when %s, and never that it may have run",
    async (_, answer, description) => {
      const user = userEvent.setup();
      answer();
      renderSection(DELETE);

      await user.click(pressed("Count Matches"));

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: "Count Matches failed",
          description,
          variant: "destructive",
        }),
      );
    },
  );

  it("says a template value won't be filled in for the check either", () => {
    renderSection(
      config("MONGODB", "delete-documents", {
        collection: "orders",
        filter: '{"_id":"{{cronium.input.id}}"}',
      }),
    );

    const note =
      "Template values such as {{cronium.input.id}} aren't filled in here: they go as written.";
    expect(pressed("Count Matches")).toHaveAccessibleDescription(
      `${COUNT_DELETE_LINE} ${note}`,
    );
    expect(screen.getByText(note)).toBeVisible();
  });
});

describe("it asks before a run that really does something", () => {
  it.each<[string, ToolActionConfig, string, string]>([
    ["a post", SLACK, "Send Message Now", SLACK_LINE],
    [
      "a prompt",
      PROMPT,
      "Prompt LLM Now",
      `${NO_TEST_MODE} sends the prompt to the model, and your provider may charge for it.`,
    ],
    ["a SQL write", EXECUTE, "Execute Statement Now", WRITES_LINE],
    ["a MongoDB delete", DELETE, "Delete Documents Now", CHECKED_WRITES_LINE],
  ])(
    "sends nothing for %s until it's confirmed",
    async (_, value, button, line) => {
      const user = userEvent.setup();
      renderSection(value);

      await user.click(pressed(button));

      const dialog = screen.getByRole("alertdialog");
      const name = button.replace(" Now", "");
      expect(within(dialog).getByRole("heading")).toHaveTextContent(
        `${name} now?`,
      );
      expect(dialog).toHaveTextContent(line);
      expect(dialog).toHaveTextContent(
        `It uses the credential my-${value.toolType.toLowerCase()}.`,
      );
      expect(mockExecute).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name }));

      await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
      expect(mockExecute).toHaveBeenCalledWith(asked(value, "run"));
      await waitFor(() =>
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
      );
    },
  );

  it("sends nothing when it's cancelled, and can be asked again", async () => {
    const user = userEvent.setup();
    renderSection(SLACK);

    await user.click(pressed("Send Message Now"));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();

    await user.click(pressed("Send Message Now"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("sends nothing when Escape closes the question", async () => {
    const user = userEvent.setup();
    renderSection(DELETE);

    await user.click(pressed("Delete Documents Now"));
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("marks only a change to data as dangerous", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSection(DELETE);
    await user.click(pressed("Delete Documents Now"));
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete Documents",
      }),
    ).toHaveClass("bg-destructive");
    unmount();

    renderSection(SLACK);
    await user.click(pressed("Send Message Now"));
    expect(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Send Message",
      }),
    ).not.toHaveClass("bg-destructive");
  });

  it("doesn't submit the form at any step", async () => {
    const user = userEvent.setup();
    renderSection(SLACK);

    await user.click(pressed("Send Message Now"));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    await run(user, "Send Message Now");
    await waitFor(() => expect(mockExecute).toHaveBeenCalled());

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it.each<[string, ToolActionConfig, string, "simulate" | "run"]>([
    ["a simulation", TRELLO, "Simulate", "simulate"],
    ["a read", RUN_QUERY, "Run Query Now", "run"],
  ])(
    "runs %s straight away, with nothing to confirm",
    async (_, value, button, mode) => {
      const user = userEvent.setup();
      renderSection(value);

      await user.click(pressed(button));

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      await waitFor(() =>
        expect(mockExecute).toHaveBeenCalledWith(asked(value, mode)),
      );
      expect(mockSubmit).not.toHaveBeenCalled();
    },
  );

  it("can't be pressed again while it runs", async () => {
    const user = userEvent.setup();
    const { answer } = answerLater();
    renderSection(TRELLO);

    await user.click(pressed("Simulate"));
    await waitFor(() => expect(pressed("Simulate")).toBeDisabled());
    await user.click(pressed("Simulate"));
    expect(mockExecute).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer({ success: true, result: {} });
      await Promise.resolve();
    });
    await waitFor(() => expect(pressed("Simulate")).toBeEnabled());
  });
});

describe("it says when a template value won't be filled in", () => {
  const TEMPLATED = config("SLACK", "slack-send-message", {
    channel: "#ops",
    text: "hello {{cronium.input.name}}",
  });
  const NOTE =
    "Template values such as {{cronium.input.name}} aren't filled in here: they go as written.";

  it("says so beside the button and when asking", async () => {
    const user = userEvent.setup();
    renderSection(TEMPLATED);

    expect(screen.getByText(NOTE)).toBeVisible();

    await user.click(pressed("Send Message Now"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(NOTE);
  });

  it("finds one deep in a parameter", () => {
    renderSection(
      config("MONGODB", "delete-documents", {
        collection: "orders",
        filter: { $or: [{ _id: "{{cronium.input.id}}" }] },
      }),
    );

    expect(
      screen.getByText(
        "Template values such as {{cronium.input.id}} aren't filled in here: they go as written.",
      ),
    ).toBeVisible();
  });

  it("says nothing when there isn't one", () => {
    renderSection(SLACK);
    expect(screen.queryByText(/Template values/)).not.toBeInTheDocument();
  });

  it("says nothing on a simulation, where nothing goes anywhere", () => {
    renderSection(
      config("TRELLO", "create-card", {
        listId: "l",
        name: "{{cronium.input.name}}",
      }),
    );
    expect(screen.queryByText(/Template values/)).not.toBeInTheDocument();
  });
});

describe("the toast says what happened", () => {
  it.each<[string, ToolActionConfig, string, unknown, string, string]>([
    [
      "a simulation",
      TRELLO,
      "Simulate",
      { success: true, cardId: "test-card-id" },
      "Simulated",
      "Nothing was sent to Trello. The parameters are valid.",
    ],
    [
      "a post",
      SLACK,
      "Send Message Now",
      { ok: true },
      "Sent",
      "Slack accepted the message.",
    ],
    [
      "a query",
      RUN_QUERY,
      "Run Query Now",
      { columns: ["n"], rows: [{ n: 1 }], rowCount: 1 },
      "Done",
      "Returned 1 row. It ran read-only, so no data changed.",
    ],
    [
      "a prompt",
      PROMPT,
      "Prompt LLM Now",
      { text: "hi" },
      "Done",
      "The model answered.",
    ],
    [
      "a statement",
      EXECUTE,
      "Execute Statement Now",
      { rowCount: 2 },
      "Done",
      "The database reports 2 rows affected.",
    ],
    [
      "a delete",
      DELETE,
      "Delete Documents Now",
      { deletedCount: 1 },
      "Done",
      "Deleted 1 document.",
    ],
  ])("after %s", async (_, value, button, result, title, description) => {
    const user = userEvent.setup();
    mockExecute.mockResolvedValue({ success: true, result });
    renderSection(value);

    await run(user, button);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({ title, description }),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it.each<[string, ToolActionConfig, string, string, string]>([
    [
      "a host that doesn't exist",
      EXECUTE,
      "Execute Statement Now",
      "getaddrinfo ENOTFOUND db.example.test",
      "Execute Statement failed",
    ],
    [
      "a webhook answering 404",
      SLACK,
      "Send Message Now",
      "Slack API error: 404 no_team",
      "Send Message failed",
    ],
    [
      "a write Run Query refused",
      RUN_QUERY,
      "Run Query Now",
      "cannot execute DELETE in a read-only transaction",
      "Run Query failed",
    ],
    [
      "a Google account that isn't connected",
      config("GOOGLE-SHEETS", "read-data"),
      "Simulate",
      "OAuth authentication required.",
      "Simulation failed",
    ],
  ])(
    "says it failed, and why, on %s",
    async (_, value, button, error, title) => {
      const user = userEvent.setup();
      mockExecute.mockResolvedValue({ success: false, error });
      renderSection(value);

      await run(user, button);

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title,
          description: error,
          variant: "destructive",
        }),
      );
      expect(mockToast).toHaveBeenCalledTimes(1);
    },
  );

  it("says it wasn't run when the server refused it", async () => {
    const user = userEvent.setup();
    mockExecute.mockRejectedValue({
      message: "Invalid parameters: channel: Required",
      data: { code: "BAD_REQUEST", httpStatus: 400 },
    });
    renderSection(SLACK);

    await run(user, "Send Message Now");

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Send Message failed",
        description: "Invalid parameters: channel: Required",
        variant: "destructive",
      }),
    );
  });

  it.each<[string, Record<string, unknown>]>([
    ["no answer came back", { message: "Failed to fetch" }],
    [
      "the server broke",
      {
        message: "An internal error occurred",
        data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
      },
    ],
  ])("says a real run may have happened when %s", async (_, failure) => {
    const user = userEvent.setup();
    mockExecute.mockRejectedValue(failure);
    renderSection(DELETE);

    await run(user, "Delete Documents Now");

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Delete Documents failed",
        description: `${String(failure.message)} It may still have run.`,
        variant: "destructive",
      }),
    );
  });

  it("doesn't say a simulation may have run", async () => {
    const user = userEvent.setup();
    mockExecute.mockRejectedValue({ message: "Failed to fetch" });
    renderSection(TRELLO);

    await run(user, "Simulate");

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Simulation failed",
        description: "Failed to fetch",
        variant: "destructive",
      }),
    );
  });

  it("goes by the action that was pressed, if another is chosen during the run", async () => {
    const user = userEvent.setup();
    const { answer } = answerLater();
    const { show } = renderSection(RUN_QUERY);

    await user.click(pressed("Run Query Now"));
    await waitFor(() => expect(mockExecute).toHaveBeenCalled());
    show(EXECUTE);
    await screen.findByRole("button", { name: "Execute Statement Now" });

    await act(async () => {
      answer({ success: true, result: { rowCount: 2 } });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Done",
        description: "Returned 2 rows. It ran read-only, so no data changed.",
      }),
    );
  });

  it("never says it ran in test mode", async () => {
    const user = userEvent.setup();
    for (const [value, button] of [
      [TRELLO, "Simulate"],
      [SLACK, "Send Message Now"],
    ] as const) {
      const { unmount } = renderSection(value);
      await run(user, button);
      unmount();
    }
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(2));

    expect(JSON.stringify(mockToast.mock.calls)).not.toMatch(
      /test mode|Test Successful/,
    );
  });
});
