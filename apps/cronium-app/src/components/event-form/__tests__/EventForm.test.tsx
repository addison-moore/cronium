/**
 * RTL safety net for EventForm: cron/interval schedule mode switching,
 * client-side validation, and payload assembly (asserted through the mocked
 * events.create mutation).
 *
 * Heavy module-level mocks:
 * - @/lib/trpc: the component reads seven hooks; all are stubbed, and the
 *   create/update mutateAsync fns are captured for payload assertions.
 * - @cronium/ui MonacoEditor: replaced with a plain textarea (the rest of the
 *   package is kept real via jest.requireActual).
 * - AIScriptAssistant-lazy: next/dynamic chunk, irrelevant here.
 */
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockCreateMutateAsync = jest.fn();
const mockUpdateMutateAsync = jest.fn();
const mockToast = jest.fn();

const sandbox = { id: 6, name: "sandbox", address: "192.0.2.10" };
// What servers.getAll answers: never an archived server (see queryServers).
let mockActiveServers: Array<typeof sandbox> = [sandbox];
let mockServerGroups: Array<{
  id: number;
  name: string;
  serverIds: number[];
}> = [];

jest.mock("@/lib/trpc", () => ({
  trpc: {
    events: {
      validateCron: {
        useQuery: () => ({ data: undefined }),
      },
      create: {
        useMutation: () => ({ mutateAsync: mockCreateMutateAsync }),
      },
      update: {
        useMutation: () => ({ mutateAsync: mockUpdateMutateAsync }),
      },
    },
    servers: {
      getAll: {
        useQuery: () => ({ data: { servers: mockActiveServers } }),
      },
      getGroups: {
        useQuery: () => ({ data: { groups: mockServerGroups } }),
      },
    },
    tools: {
      getAll: {
        useQuery: () => ({ data: { tools: [] } }),
      },
    },
    settings: {
      getEditorSettings: {
        useQuery: () => ({ data: undefined }),
      },
      updateEditorSettings: {
        useMutation: () => ({
          mutate: jest.fn(),
          mutateAsync: jest.fn(),
          isPending: false,
        }),
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
    useToast: () => ({ toast: mockToast }),
    MonacoEditor: ({
      value,
      onChange,
    }: {
      value?: string;
      onChange?: (value: string | undefined) => void;
    }) =>
      ReactActual.createElement("textarea", {
        "data-testid": "monaco-stub",
        value: value ?? "",
        onChange: (e: { target: { value: string } }) =>
          onChange?.(e.target.value),
      }),
  };
});

jest.mock("@/components/dashboard/AIScriptAssistant-lazy", () => ({
  __esModule: true,
  default: () => null,
}));

import EventForm from "../EventForm";
import {
  EventType,
  EventTriggerType,
  RunLocation,
  TimeUnit,
} from "@/shared/schema";
import { MAX_REQUEST_BODY_BYTES } from "@/shared/request-limits";
import { saveRequestBytes } from "../lib/event-payload";

const scheduledBashEvent = {
  type: EventType.BASH,
  content: "echo hello",
  triggerType: EventTriggerType.SCHEDULE,
};

describe("EventForm", () => {
  beforeEach(() => {
    mockCreateMutateAsync.mockReset().mockResolvedValue({ id: 123 });
    mockUpdateMutateAsync.mockReset().mockResolvedValue({ id: 123 });
    mockToast.mockReset();
    mockActiveServers = [sandbox];
    mockServerGroups = [];
  });

  describe("cron/interval mode switching", () => {
    it("shows interval fields by default and swaps them for the cron field when toggled", async () => {
      const user = userEvent.setup();
      render(<EventForm initialData={scheduledBashEvent} />);

      // Interval mode fields are visible, cron field is not
      expect(screen.getByLabelText("Interval")).toBeInTheDocument();
      expect(screen.getByLabelText("Interval Unit")).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Cron Expression"),
      ).not.toBeInTheDocument();

      // Switch to cron mode
      await user.click(
        screen.getByRole("switch", { name: "Use Cron Scheduling" }),
      );
      expect(screen.getByLabelText("Cron Expression")).toBeInTheDocument();
      expect(screen.queryByLabelText("Interval")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Interval Unit")).not.toBeInTheDocument();

      // And back to interval mode
      await user.click(
        screen.getByRole("switch", { name: "Use Cron Scheduling" }),
      );
      expect(screen.getByLabelText("Interval")).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Cron Expression"),
      ).not.toBeInTheDocument();
    });

    it("hides the whole schedule section for manual events", () => {
      render(
        <EventForm
          initialData={{
            ...scheduledBashEvent,
            triggerType: EventTriggerType.MANUAL,
          }}
        />,
      );
      expect(screen.queryByText("Schedule Settings")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Interval")).not.toBeInTheDocument();
    });
  });

  describe("validation", () => {
    it("surfaces the name-required error and does not call the mutation", async () => {
      const user = userEvent.setup();
      render(<EventForm initialData={scheduledBashEvent} />);

      await user.click(screen.getByRole("button", { name: "Create Event" }));

      expect(
        await screen.findByText("Event name is required"),
      ).toBeInTheDocument();
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    it("surfaces the 100-char name cap inline instead of a server error (regression, FINDINGS #45)", async () => {
      const user = userEvent.setup();
      render(<EventForm initialData={scheduledBashEvent} />);

      fireEvent.change(screen.getByLabelText("Event Name"), {
        target: { value: "n".repeat(101) },
      });
      await user.click(screen.getByRole("button", { name: "Create Event" }));

      expect(
        await screen.findByText("Event name must be less than 100 characters"),
      ).toBeInTheDocument();
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    it("surfaces the 10s interval floor inline instead of a server error (regression, FINDINGS #45)", async () => {
      const user = userEvent.setup();
      render(
        <EventForm
          initialData={{
            ...scheduledBashEvent,
            scheduleUnit: TimeUnit.SECONDS,
          }}
        />,
      );

      await user.type(screen.getByLabelText("Event Name"), "Too Fast");
      fireEvent.change(screen.getByLabelText("Interval"), {
        target: { value: "9" },
      });
      await user.click(screen.getByRole("button", { name: "Create Event" }));

      expect(
        await screen.findByText("Intervals below 10 seconds are not supported"),
      ).toBeInTheDocument();
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();

      // Raising it to the 10s boundary clears the error and submits
      fireEvent.change(screen.getByLabelText("Interval"), {
        target: { value: "10" },
      });
      await user.click(screen.getByRole("button", { name: "Create Event" }));
      await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalled());
      expect(mockCreateMutateAsync.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          scheduleNumber: 10,
          scheduleUnit: "SECONDS",
        }),
      );
    });
  });

  describe("environment variables", () => {
    async function addVariable(key: string, value: string) {
      const user = userEvent.setup();
      render(<EventForm initialData={scheduledBashEvent} />);
      await user.type(screen.getByLabelText("Event Name"), "With variables");
      await user.click(screen.getByRole("button", { name: "Add Variable" }));
      fireEvent.change(screen.getByLabelText("Key"), {
        target: { value: key },
      });
      // Pasted, in effect: typing this many characters would take minutes.
      fireEvent.change(screen.getByLabelText("Value"), {
        target: { value },
      });
      await user.click(screen.getByRole("button", { name: "Create Event" }));
      return user;
    }

    const tooLongMessage = /environment variable value can be at most 128 KB/;

    it("submits a value too long for the old column", async () => {
      const value = "x".repeat(4_096);
      await addVariable("TOKEN", value);

      await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalled());
      expect(mockCreateMutateAsync.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ envVars: [{ key: "TOKEN", value }] }),
      );
    });

    it("says beside the row that a value is too long, and saves nothing", async () => {
      await addVariable("TOKEN", "x".repeat(128_001));

      expect(await screen.findByText(tooLongMessage)).toBeInTheDocument();
      expect(screen.getByLabelText("Value")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    it("clears the message once the value fits", async () => {
      await addVariable("TOKEN", "x".repeat(128_001));
      await screen.findByText(tooLongMessage);

      fireEvent.change(screen.getByLabelText("Value"), {
        target: { value: "x".repeat(128_000) },
      });

      await waitFor(() =>
        expect(screen.queryByText(tooLongMessage)).not.toBeInTheDocument(),
      );
    });

    it("asks for a missing key beside the row", async () => {
      await addVariable("", "some value");

      expect(
        await screen.findByText("Environment variable key is required"),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Key")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    describe("a value with line breaks", () => {
      const multiLine = "-----BEGIN KEY-----\nabc\n-----END KEY-----\n";
      const noteFor = (count: number) =>
        `This value has ${count} line ${count === 1 ? "break" : "breaks"}. Show it to edit.`;

      const valueField = () => screen.getByLabelText("Value");
      const showValue = () =>
        screen.getByRole("button", { name: "Show value" });
      const hideValue = () =>
        screen.getByRole("button", { name: "Hide value" });

      async function renderWithEmptyRow() {
        const user = userEvent.setup();
        render(<EventForm initialData={scheduledBashEvent} />);
        await user.type(screen.getByLabelText("Event Name"), "With a key");
        await user.click(screen.getByRole("button", { name: "Add Variable" }));
        await user.type(screen.getByLabelText("Key"), "PEM");
        return user;
      }

      function renderSaved(value: string) {
        const user = userEvent.setup();
        render(
          <EventForm
            initialData={{
              ...scheduledBashEvent,
              name: "Set over the API",
              environmentVariables: [{ key: "PEM", value }],
            }}
          />,
        );
        return user;
      }

      async function save(user: ReturnType<typeof userEvent.setup>) {
        await user.click(screen.getByRole("button", { name: "Create Event" }));
        await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalled());
        return (
          mockCreateMutateAsync.mock.calls[0]?.[0] as { envVars: unknown }
        ).envVars;
      }

      describe("while it's hidden", () => {
        it("is only ever in a password input", async () => {
          const user = renderSaved(multiLine);
          expect(valueField()).toHaveAttribute("type", "password");

          await user.click(showValue());
          expect(valueField().tagName).toBe("TEXTAREA");
          expect(valueField()).toHaveValue(multiLine);

          await user.click(hideValue());
          expect(valueField()).toHaveAttribute("type", "password");
        });

        it("saves a paste with all its line breaks, and says it has them", async () => {
          const user = await renderWithEmptyRow();
          await user.click(valueField());
          await user.paste(multiLine);

          expect(valueField()).toHaveAttribute("type", "password");
          expect(valueField()).toHaveAccessibleDescription(noteFor(3));
          expect(await save(user)).toEqual([{ key: "PEM", value: multiLine }]);
        });

        it("gives a paste's Windows line endings as a textarea would", async () => {
          const user = await renderWithEmptyRow();
          await user.click(valueField());
          await user.paste("one\r\ntwo\r\n");

          expect(await save(user)).toEqual([
            { key: "PEM", value: "one\ntwo\n" },
          ]);
        });

        it("drops the line break at the end of one pasted line", async () => {
          const user = await renderWithEmptyRow();
          await user.click(valueField());
          await user.paste("eyJhbGciOiJSUzI1NiJ9.abc.def\n");

          expect(screen.queryByText(/line break/)).not.toBeInTheDocument();
          expect(await save(user)).toEqual([
            { key: "PEM", value: "eyJhbGciOiJSUzI1NiJ9.abc.def" },
          ]);
        });

        it("puts a paste where the selection is", async () => {
          const user = renderSaved("start-end");
          const field = valueField() as HTMLInputElement;
          await user.click(field);
          field.setSelectionRange(5, 6);
          await user.paste("one\ntwo");

          expect(await save(user)).toEqual([
            { key: "PEM", value: "startone\ntwoend" },
          ]);
        });

        it("drops only a pasted line's own line break, with the caret after it", async () => {
          const user = renderSaved("start-end");
          const field = valueField() as HTMLInputElement;
          await user.click(field);
          field.setSelectionRange(5, 6);
          await user.paste("one\n");

          expect(field).toHaveValue("startoneend");
          expect(field).not.toHaveAttribute("readonly");

          await user.keyboard("!");
          expect(await save(user)).toEqual([
            { key: "PEM", value: "startone!end" },
          ]);
        });

        // Once someone has edited a field, a browser fires `change` when it loses
        // focus. The input only holds a flattened copy of this value by then.
        it("keeps a paste's line breaks when the field loses focus after an edit", async () => {
          const user = await renderWithEmptyRow();
          await user.type(valueField(), "typed-");
          await user.paste("one\ntwo");
          fireEvent.change(valueField());

          expect(screen.getByText(noteFor(1))).toBeInTheDocument();
          expect(await save(user)).toEqual([
            { key: "PEM", value: "typed-one\ntwo" },
          ]);
        });

        it("takes a drop the way it takes a paste", async () => {
          const user = await renderWithEmptyRow();
          fireEvent.drop(valueField(), {
            dataTransfer: { getData: () => multiLine },
          });

          expect(await save(user)).toEqual([{ key: "PEM", value: multiLine }]);
        });

        it("leaves one pasted line with none to the input", async () => {
          const user = await renderWithEmptyRow();
          await user.click(valueField());
          await user.paste("plain");
          await user.keyboard("-typed");

          expect(valueField()).not.toHaveAttribute("readonly");
          expect(await save(user)).toEqual([
            { key: "PEM", value: "plain-typed" },
          ]);
        });

        it("can't be edited, so an edit can't lose them", async () => {
          const user = renderSaved(multiLine);
          expect(valueField()).toHaveAttribute("readonly");
          expect(screen.getByText(noteFor(3))).toBeInTheDocument();

          await user.type(valueField(), "typed");
          await user.click(valueField());
          await user.paste("pasted\nover");

          expect(await save(user)).toEqual([{ key: "PEM", value: multiLine }]);
        });

        it.each([
          ["line feeds", multiLine],
          ["Windows line endings", "one\r\ntwo\r\n"],
          ["one at the end", "token\n"],
        ])("keeps %s nobody edited", async (_name, value) => {
          const user = renderSaved(value);

          expect(await save(user)).toEqual([{ key: "PEM", value }]);
        });

        it("still saves the form on Enter, as a one-line value did", async () => {
          const user = await renderWithEmptyRow();
          await user.type(valueField(), "typed{Enter}");

          await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalled());
          expect(mockCreateMutateAsync.mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
              envVars: [{ key: "PEM", value: "typed" }],
            }),
          );
        });
      });

      describe("once it's shown", () => {
        it("takes a paste with all its line breaks", async () => {
          const user = await renderWithEmptyRow();
          await user.click(showValue());
          await user.click(valueField());
          await user.paste(multiLine);

          expect(valueField()).toHaveValue(multiLine);
          expect(await save(user)).toEqual([{ key: "PEM", value: multiLine }]);
        });

        it("drops the line break at the end of one pasted line", async () => {
          const user = await renderWithEmptyRow();
          await user.click(showValue());
          await user.click(valueField());
          await user.paste("token\n");

          expect(valueField()).toHaveValue("token");
        });

        it("leaves a typed line break alone when one line is pasted elsewhere", async () => {
          const user = await renderWithEmptyRow();
          await user.click(showValue());
          await user.type(valueField(), "abc{Enter}");
          (valueField() as HTMLTextAreaElement).setSelectionRange(0, 0);
          await user.paste("x");

          expect(valueField()).toHaveValue("xabc\n");
          expect(await save(user)).toEqual([{ key: "PEM", value: "xabc\n" }]);
        });

        it("drops only a pasted line's own line break, with the caret after it", async () => {
          const user = renderSaved("start-end");
          await user.click(showValue());
          await user.click(valueField());
          (valueField() as HTMLTextAreaElement).setSelectionRange(5, 6);
          await user.paste("one\n");
          expect(valueField()).toHaveValue("startoneend");

          await user.keyboard("!");
          expect(await save(user)).toEqual([
            { key: "PEM", value: "startone!end" },
          ]);
        });

        it("leaves the caret after a multi-line paste", async () => {
          const user = renderSaved("start-end");
          await user.click(showValue());
          await user.click(valueField());
          (valueField() as HTMLTextAreaElement).setSelectionRange(5, 6);
          await user.paste("one\ntwo\n");

          await user.keyboard("!");
          expect(await save(user)).toEqual([
            { key: "PEM", value: "startone\ntwo\n!end" },
          ]);
        });

        it("still sees an edit that undoes a pasted line", async () => {
          const user = await renderWithEmptyRow();
          await user.click(showValue());
          await user.click(valueField());
          await user.paste("x\n");
          await user.keyboard("{Backspace}");

          expect(await save(user)).toEqual([{ key: "PEM", value: "" }]);
        });

        it("adds a line break on Enter instead of saving", async () => {
          const user = await renderWithEmptyRow();
          await user.click(showValue());
          await user.type(valueField(), "one{Enter}two{Enter}");

          expect(valueField()).toHaveValue("one\ntwo\n");
          expect(mockCreateMutateAsync).not.toHaveBeenCalled();
        });

        it("keeps them through an edit", async () => {
          const user = renderSaved(multiLine);
          await user.click(showValue());
          await user.type(valueField(), "more");

          expect(await save(user)).toEqual([
            { key: "PEM", value: `${multiLine}more` },
          ]);
        });

        it("keeps the browser and writing extensions out", async () => {
          const user = renderSaved(multiLine);
          await user.click(showValue());

          expect(valueField()).toHaveAttribute("spellcheck", "false");
          expect(valueField()).toHaveAttribute("autocomplete", "off");
          expect(valueField()).toHaveAttribute("data-gramm", "false");
        });

        it.each([
          ["one line", "one", 1],
          ["three lines", "one\ntwo\nthree", 3],
          ["a last line break", "one\ntwo\n", 3],
          ["more lines than fit", "line\n".repeat(1_000), 8],
        ])("sizes the field to %s", async (_name, value, rows) => {
          const user = renderSaved(value);
          await user.click(showValue());

          expect(valueField()).toHaveAttribute("rows", String(rows));
        });
      });

      it("doesn't show the next row when a shown one is deleted", async () => {
        const user = userEvent.setup();
        render(
          <EventForm
            initialData={{
              ...scheduledBashEvent,
              environmentVariables: [
                { key: "FIRST", value: "first secret" },
                { key: "SECOND", value: "second secret" },
                { key: "THIRD", value: "third secret" },
              ],
            }}
          />,
        );
        // Show the second row, then delete the first: the third is now second.
        await user.click(
          screen.getAllByRole("button", { name: "Show value" })[1]!,
        );
        await user.click(screen.getAllByRole("button", { name: "×" })[0]!);

        for (const field of screen.getAllByLabelText("Value")) {
          expect(field).toHaveAttribute("type", "password");
        }
      });
    });

    it("says when the variables are too much together", async () => {
      const user = userEvent.setup();
      render(<EventForm initialData={scheduledBashEvent} />);
      await user.type(screen.getByLabelText("Event Name"), "With variables");
      for (let row = 0; row < 8; row += 1) {
        await user.click(screen.getByRole("button", { name: "Add Variable" }));
        fireEvent.change(screen.getAllByLabelText("Key")[row]!, {
          target: { value: `K${row}` },
        });
        fireEvent.change(screen.getAllByLabelText("Value")[row]!, {
          target: { value: "x".repeat(128_000) },
        });
      }
      await user.click(screen.getByRole("button", { name: "Create Event" }));

      expect(
        await screen.findByText(/can be at most 1 MB in total/),
      ).toBeInTheDocument();
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    // The submit button is a screen or more below this card, so a message nobody
    // scrolled to would read as a button that does nothing.
    it("moves the focus to the list when a save fails on it", async () => {
      await addVariable("TOKEN", "x".repeat(128_001));
      await screen.findByText(tooLongMessage);

      const list = screen.getByLabelText("Value").closest("[tabindex]");
      await waitFor(() => expect(list).toHaveFocus());
    });
  });

  describe("payload assembly", () => {
    async function submitForm(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: "Create Event" }));
      await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalled());
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Create Event" }),
        ).toBeEnabled(),
      );
      expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1);
      return mockCreateMutateAsync.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
    }

    it("assembles an interval-mode payload without cron or form-only fields", async () => {
      const user = userEvent.setup();
      render(<EventForm initialData={scheduledBashEvent} />);

      await user.type(screen.getByLabelText("Event Name"), "Nightly Sync");
      fireEvent.change(screen.getByLabelText("Interval"), {
        target: { value: "15" },
      });

      const payload = await submitForm(user);

      expect(payload).toEqual(
        expect.objectContaining({
          name: "Nightly Sync",
          type: EventType.BASH,
          content: "echo hello",
          triggerType: EventTriggerType.SCHEDULE,
          scheduleNumber: 15,
          scheduleUnit: "MINUTES",
          timezone: "UTC",
          runLocation: "LOCAL",
          serverId: null,
          startTime: null,
          selectedServerIds: [],
        }),
      );
      expect(payload.customSchedule).toBeUndefined();
      expect(payload).not.toHaveProperty("useCronScheduling");
      expect(payload).not.toHaveProperty("runOnLocal");
      expect(payload).not.toHaveProperty("httpHeaders");
    });

    it("assembles a cron-mode payload and leaves the interval fields untouched", async () => {
      const user = userEvent.setup();
      render(<EventForm initialData={scheduledBashEvent} />);

      await user.type(screen.getByLabelText("Event Name"), "Cron Job");
      await user.click(
        screen.getByRole("switch", { name: "Use Cron Scheduling" }),
      );
      await user.type(screen.getByLabelText("Cron Expression"), "*/5 * * * *");

      const payload = await submitForm(user);

      expect(payload).toEqual(
        expect.objectContaining({
          name: "Cron Job",
          customSchedule: "*/5 * * * *",
          // Interval fields ride along untouched at their defaults
          scheduleNumber: 5,
          scheduleUnit: "MINUTES",
        }),
      );
    });

    it("omits the cron expression after switching back to interval mode", async () => {
      const user = userEvent.setup();
      render(<EventForm initialData={scheduledBashEvent} />);

      await user.type(screen.getByLabelText("Event Name"), "Toggled Back");
      const cronSwitch = screen.getByRole("switch", {
        name: "Use Cron Scheduling",
      });
      await user.click(cronSwitch);
      await user.type(screen.getByLabelText("Cron Expression"), "0 0 * * *");
      await user.click(cronSwitch);

      const payload = await submitForm(user);

      expect(payload.customSchedule).toBeUndefined();
      expect(payload).toEqual(
        expect.objectContaining({ scheduleNumber: 5, scheduleUnit: "MINUTES" }),
      );
    });

    it("derives runLocation from the execution-location checkboxes", async () => {
      const user = userEvent.setup();
      render(<EventForm initialData={scheduledBashEvent} />);

      await user.type(screen.getByLabelText("Event Name"), "Remote Only");
      // Select the remote server, deselect the local host
      await user.click(
        screen.getByRole("checkbox", { name: "sandbox (192.0.2.10)" }),
      );
      await user.click(
        screen.getByRole("checkbox", { name: "Local (Cronium host)" }),
      );

      const payload = await submitForm(user);

      expect(payload).toEqual(
        expect.objectContaining({
          runLocation: "REMOTE",
          selectedServerIds: [6],
        }),
      );
      expect(payload).not.toHaveProperty("runOnLocal");
    });
  });

  describe("a save too long for one request", () => {
    const manualBashEvent = {
      type: EventType.BASH,
      content: "echo hello",
      triggerType: EventTriggerType.MANUAL,
    };
    const tooLong = /This script is too long to save/;
    const consoleError = () =>
      jest.spyOn(console, "error").mockImplementation(() => undefined);

    function setScript(script: string) {
      // Pasted, in effect: typing this many characters would take days.
      fireEvent.change(screen.getByTestId("monaco-stub"), {
        target: { value: script },
      });
    }

    async function save(
      user: ReturnType<typeof userEvent.setup>,
      button = "Create Event",
    ) {
      await user.click(screen.getByRole("button", { name: button }));
    }

    async function renderNamed() {
      const user = userEvent.setup();
      render(<EventForm initialData={manualBashEvent} />);
      await user.type(screen.getByLabelText("Event Name"), "Long");
      return user;
    }

    /** A script that brings this form's request to exactly `bytes`. */
    async function scriptForRequestOf(
      bytes: number,
      user: ReturnType<typeof userEvent.setup>,
    ) {
      await save(user);
      await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalled());
      const input = mockCreateMutateAsync.mock.calls[0]?.[0] as object;
      const shell = saveRequestBytes({ ...input, content: "" });
      mockCreateMutateAsync.mockClear();
      return "x".repeat(bytes - shell);
    }

    it("refuses a script past the limit before sending anything, and says why beside it", async () => {
      const user = await renderNamed();

      setScript("x".repeat(MAX_REQUEST_BODY_BYTES + 1));
      await save(user);

      expect(await screen.findByText(tooLong)).toHaveTextContent(
        /comes to 10\.01 MB once sent, and the limit is 10 MB/,
      );
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("brings the script into view, because the submit button is a screen or more below it", async () => {
      const user = await renderNamed();

      setScript("x".repeat(MAX_REQUEST_BODY_BYTES + 1));
      await save(user);

      await screen.findByText(tooLong);
      expect(screen.getByTestId("monaco-stub").parentElement).toHaveFocus();
    });

    it("sends a request of exactly the limit, and refuses one byte more", async () => {
      const user = await renderNamed();
      const script = await scriptForRequestOf(MAX_REQUEST_BODY_BYTES, user);

      setScript(script);
      await save(user);
      await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalled());
      expect(screen.queryByText(tooLong)).not.toBeInTheDocument();

      mockCreateMutateAsync.mockClear();
      setScript(`${script}x`);
      await save(user);
      expect(await screen.findByText(tooLong)).toBeInTheDocument();
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    it("counts what's sent, so a script under 10 MB can still be too long", async () => {
      const user = await renderNamed();

      // 6 MB of script, and 12 MB of JSON.
      setScript(`echo hi${"\n".repeat(6 * 1024 * 1024)}`);
      await save(user);

      expect(await screen.findByText(tooLong)).toHaveTextContent(/12\.\d+ MB/);
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    it("clears the message once the script is edited, and saves when it fits", async () => {
      const user = await renderNamed();

      setScript("x".repeat(MAX_REQUEST_BODY_BYTES + 1));
      await save(user);
      await screen.findByText(tooLong);

      setScript("echo short");
      await waitFor(() =>
        expect(screen.queryByText(tooLong)).not.toBeInTheDocument(),
      );

      await save(user);
      await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalled());
    });

    it("checks an update the same way, on the request it would send", async () => {
      const user = userEvent.setup();
      render(
        <EventForm
          initialData={{ ...manualBashEvent, name: "Long" }}
          isEditing
          eventId={7}
        />,
      );

      setScript("x".repeat(MAX_REQUEST_BODY_BYTES + 1));
      await save(user, "Update Event");

      expect(await screen.findByText(tooLong)).toBeInTheDocument();
      expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
    });

    it("says so in a toast for an event with no script field to show it beside", async () => {
      const user = userEvent.setup();
      render(
        <EventForm
          initialData={{
            type: EventType.HTTP_REQUEST,
            triggerType: EventTriggerType.MANUAL,
            name: "Long",
            httpMethod: "POST",
            httpUrl: "https://api.example.test/",
            httpBody: "x".repeat(MAX_REQUEST_BODY_BYTES + 1),
          }}
        />,
      );

      await save(user);

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Too long to save",
            description: expect.stringContaining(
              "This event is too long to save",
            ) as string,
            variant: "destructive",
          }),
        ),
      );
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    it("shows the server's own words if the server refuses it after all", async () => {
      consoleError();
      const message = "This event is too long to save, from the server";
      mockCreateMutateAsync.mockRejectedValue(new Error(message));
      const user = await renderNamed();

      await save(user);

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            description: message,
            variant: "destructive",
          }),
        ),
      );
    });
  });

  describe("a server the event is linked to that the list leaves out", () => {
    const retiredBox = {
      id: 9,
      name: "retired-box",
      address: "192.0.2.20",
      isArchived: true,
    };
    const ARCHIVED_ROW = "retired-box (192.0.2.20) Archived";
    const SANDBOX_ROW = "sandbox (192.0.2.10)";
    const NOTICE = /can't be saved or run while an archived server is ticked/;

    function eventOn(
      servers: Array<{
        id: number;
        name: string;
        address: string;
        isArchived?: boolean;
      }>,
      overrides: Record<string, unknown> = {},
    ) {
      return {
        name: "Nightly job",
        type: EventType.BASH,
        content: "echo hello",
        runLocation: RunLocation.REMOTE,
        servers,
        ...overrides,
      };
    }

    function renderEditing(initialData: ReturnType<typeof eventOn>) {
      render(<EventForm initialData={initialData} isEditing eventId={5} />);
      return userEvent.setup();
    }

    function rowNames() {
      return screen
        .getAllByRole("checkbox")
        .map((box) => box.getAttribute("id"));
    }

    async function save(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: "Update Event" }));
    }

    function lastUpdate() {
      return mockUpdateMutateAsync.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
    }

    it("lists an archived server ticked and labelled, ahead of the others", async () => {
      renderEditing(eventOn([retiredBox]));

      expect(
        await screen.findByRole("checkbox", {
          name: ARCHIVED_ROW,
          checked: true,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: SANDBOX_ROW, checked: false }),
      ).toBeInTheDocument();
      // First, so a long server list can't scroll it out of view.
      expect(rowNames()).toEqual(["location-local", "server-9", "server-6"]);
      expect(screen.getByText(NOTICE)).toBeInTheDocument();
    });

    it("repoints the event: untick the archived server, tick another, save", async () => {
      const user = renderEditing(eventOn([retiredBox]));

      await user.click(
        await screen.findByRole("checkbox", { name: ARCHIVED_ROW }),
      );
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
      await user.click(screen.getByRole("checkbox", { name: SANDBOX_ROW }));
      await save(user);

      await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
      expect(lastUpdate()).toEqual(
        expect.objectContaining({
          id: 5,
          runLocation: "REMOTE",
          selectedServerIds: [6],
          serverId: null,
        }),
      );
    });

    it("keeps the row after unticking, so a slip can be undone", async () => {
      const user = renderEditing(eventOn([retiredBox]));
      const row = await screen.findByRole("checkbox", { name: ARCHIVED_ROW });

      await user.click(row);
      expect(row).not.toBeChecked();
      await user.click(row);

      expect(row).toBeChecked();
      expect(screen.getByText(NOTICE)).toBeInTheDocument();
    });

    it("won't quietly move a REMOTE event to LOCAL when its only server is unticked", async () => {
      const user = renderEditing(eventOn([retiredBox]));

      await user.click(
        await screen.findByRole("checkbox", { name: ARCHIVED_ROW }),
      );
      await save(user);

      expect(
        await screen.findByText("Select at least one execution location"),
      ).toBeInTheDocument();
      expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
    });

    it("sends an untouched archived server as it stands and shows the server's refusal", async () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const reason =
        "An archived server can't be used: retired-box. Restore it or choose another server, then try again.";
      mockUpdateMutateAsync.mockRejectedValueOnce(new Error(reason));
      const user = renderEditing(eventOn([retiredBox]));
      await screen.findByRole("checkbox", {
        name: ARCHIVED_ROW,
        checked: true,
      });

      await save(user);

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: "Error",
          description: reason,
          variant: "destructive",
        }),
      );
      // Not dropped on the way: with nothing selected this would be a LOCAL event.
      expect(lastUpdate()).toEqual(
        expect.objectContaining({
          runLocation: "REMOTE",
          selectedServerIds: [9],
        }),
      );
    });

    it("leaves a LOCAL_AND_REMOTE event local once its archived server is unticked", async () => {
      const user = renderEditing(
        eventOn([retiredBox], { runLocation: RunLocation.LOCAL_AND_REMOTE }),
      );

      await user.click(
        await screen.findByRole("checkbox", { name: ARCHIVED_ROW }),
      );
      await save(user);

      await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
      expect(lastUpdate()).toEqual(
        expect.objectContaining({
          runLocation: "LOCAL",
          selectedServerIds: [],
        }),
      );
    });

    it("treats a server restored since the event loaded as an ordinary one", async () => {
      mockActiveServers = [
        sandbox,
        { id: 9, name: "retired-box", address: "192.0.2.20" },
      ];
      const user = renderEditing(eventOn([retiredBox]));

      expect(
        await screen.findByRole("checkbox", {
          name: "retired-box (192.0.2.20)",
          checked: true,
        }),
      ).toBeInTheDocument();
      expect(rowNames()).toEqual(["location-local", "server-6", "server-9"]);
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();

      await save(user);

      await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
      expect(lastUpdate().selectedServerIds).toEqual([9]);
    });

    it("keeps a row for a linked server the list didn't return, without calling it archived", async () => {
      // One past the list's limit of 100, or archived since the event loaded.
      const unlisted = { id: 150, name: "far-box", address: "192.0.2.30" };
      const user = renderEditing(eventOn([unlisted]));

      const row = await screen.findByRole("checkbox", {
        name: "far-box (192.0.2.30)",
        checked: true,
      });
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();

      await user.click(row);
      expect(row).not.toBeChecked();
    });

    it("shows the archived row instead of saying there are no servers", async () => {
      mockActiveServers = [];
      renderEditing(eventOn([retiredBox]));

      expect(
        await screen.findByRole("checkbox", {
          name: ARCHIVED_ROW,
          checked: true,
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("No servers available"),
      ).not.toBeInTheDocument();
    });

    it("still says there are no servers when there are none at all", () => {
      mockActiveServers = [];
      renderEditing(eventOn([]));

      expect(screen.getByText("No servers available")).toBeInTheDocument();
    });

    describe("in a server group", () => {
      beforeEach(() => {
        mockServerGroups = [{ id: 1, name: "fleet", serverIds: [6, 9] }];
      });

      it("doesn't count the archived member or tick it back", async () => {
        const user = renderEditing(eventOn([retiredBox]));
        const row = await screen.findByRole("checkbox", { name: ARCHIVED_ROW });
        await user.click(row);

        await user.click(screen.getByRole("button", { name: "fleet (1)" }));

        expect(
          screen.getByRole("checkbox", { name: SANDBOX_ROW }),
        ).toBeChecked();
        expect(row).not.toBeChecked();
      });

      it("doesn't untick the archived member either", async () => {
        const user = renderEditing(eventOn([retiredBox]));
        const row = await screen.findByRole("checkbox", {
          name: ARCHIVED_ROW,
          checked: true,
        });
        const group = screen.getByRole("button", { name: "fleet (1)" });

        await user.click(group);
        await user.click(group);

        expect(
          screen.getByRole("checkbox", { name: SANDBOX_ROW }),
        ).not.toBeChecked();
        expect(row).toBeChecked();
      });
    });

    describe("through the deprecated direct server", () => {
      function directEvent(overrides: Record<string, unknown> = {}) {
        return eventOn([], {
          serverId: retiredBox.id,
          server: retiredBox,
          ...overrides,
        });
      }

      it("lists an archived one the same way, and unticking it unlinks it", async () => {
        const user = renderEditing(directEvent());
        const row = await screen.findByRole("checkbox", {
          name: ARCHIVED_ROW,
          checked: true,
        });

        await user.click(row);
        await user.click(screen.getByRole("checkbox", { name: SANDBOX_ROW }));
        await save(user);

        await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
        expect(lastUpdate()).toEqual(
          expect.objectContaining({
            runLocation: "REMOTE",
            selectedServerIds: [6],
            serverId: null,
          }),
        );
      });

      it("lists a server once when it's both the direct one and a link", async () => {
        renderEditing(directEvent({ servers: [retiredBox] }));

        await screen.findByRole("checkbox", {
          name: ARCHIVED_ROW,
          checked: true,
        });
        expect(rowNames()).toEqual(["location-local", "server-9", "server-6"]);
      });

      it("leaves one on a LOCAL event alone, because ticking it would add a server", () => {
        renderEditing(directEvent({ runLocation: RunLocation.LOCAL }));

        expect(rowNames()).toEqual(["location-local", "server-6"]);
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
      });
    });

    describe("when the same event comes back as a new object", () => {
      // EventEditTab hands over a new object on every render, and every toast
      // re-renders it. See __tests__/EventEditTab.test.tsx for that wiring.
      const event = eventOn([retiredBox], { id: 5 });

      function renderWithRerender() {
        const view = render(
          <EventForm initialData={event} isEditing eventId={5} />,
        );
        return {
          user: userEvent.setup(),
          again: (data: Record<string, unknown>) =>
            view.rerender(
              <EventForm initialData={data} isEditing eventId={5} />,
            ),
        };
      }

      it("leaves an unticked server unticked", async () => {
        const { user, again } = renderWithRerender();
        const row = await screen.findByRole("checkbox", {
          name: ARCHIVED_ROW,
          checked: true,
        });
        await user.click(row);

        again({ ...event });

        expect(row).not.toBeChecked();
      });

      it("leaves an edited env var in place", async () => {
        const { user, again } = renderWithRerender();
        await user.click(screen.getByRole("button", { name: "Add Variable" }));
        fireEvent.change(screen.getByLabelText("Key"), {
          target: { value: "MY_VAR" },
        });

        again({ ...event, environmentVariables: [] });

        expect(screen.getByLabelText("Key")).toHaveValue("MY_VAR");
      });

      it("leaves a script written over the template in place", () => {
        const empty = { ...event, content: "" };
        const view = render(
          <EventForm initialData={empty} isEditing eventId={5} />,
        );
        fireEvent.change(screen.getByTestId("monaco-stub"), {
          target: { value: "echo mine" },
        });

        view.rerender(
          <EventForm initialData={{ ...empty }} isEditing eventId={5} />,
        );

        expect(screen.getByTestId("monaco-stub")).toHaveValue("echo mine");
      });

      it("still labels a server archived since the form loaded", async () => {
        const live = { id: 11, name: "gone-box", address: "192.0.2.40" };
        const withLive = eventOn([live], { id: 5 });
        const view = render(
          <EventForm initialData={withLive} isEditing eventId={5} />,
        );
        await screen.findByRole("checkbox", {
          name: "gone-box (192.0.2.40)",
          checked: true,
        });
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();

        view.rerender(
          <EventForm
            initialData={eventOn([{ ...live, isArchived: true }], { id: 5 })}
            isEditing
            eventId={5}
          />,
        );

        expect(
          screen.getByRole("checkbox", {
            name: "gone-box (192.0.2.40) Archived",
            checked: true,
          }),
        ).toBeInTheDocument();
        expect(screen.getByText(NOTICE)).toBeInTheDocument();
      });

      it("takes up a different event's servers", async () => {
        const { user, again } = renderWithRerender();
        await user.click(
          await screen.findByRole("checkbox", { name: ARCHIVED_ROW }),
        );

        again(eventOn([sandbox], { id: 6 }));

        expect(
          await screen.findByRole("checkbox", {
            name: SANDBOX_ROW,
            checked: true,
          }),
        ).toBeInTheDocument();
        expect(rowNames()).toEqual(["location-local", "server-6"]);
      });
    });

    it("shows no extra rows when creating an event", () => {
      render(<EventForm initialData={scheduledBashEvent} />);

      expect(rowNames()).toEqual(["location-local", "server-6"]);
    });
  });

  // Set through the REST API, MCP or a JSON import. The form itself only writes links.
  describe("an active direct server", () => {
    const otherBox = { id: 7, name: "other-box", address: "192.0.2.30" };
    const thirdBox = { id: 8, name: "third-box", address: "192.0.2.40" };
    const retiredBox = {
      id: 9,
      name: "retired-box",
      address: "192.0.2.20",
      isArchived: true,
    };
    const DIRECT_ROW = "sandbox (192.0.2.10)";
    const OTHER_ROW = "other-box (192.0.2.30)";
    const THIRD_ROW = "third-box (192.0.2.40)";
    const LOCAL_ROW = "Local (Cronium host)";
    const ARCHIVED_ROW = "retired-box (192.0.2.20) Archived";
    const ARCHIVED_NOTICE =
      /can't be saved or run while an archived server is ticked/;
    const NO_LOCATION = "Select at least one execution location";

    function directEvent(
      runLocation: RunLocation,
      overrides: Record<string, unknown> = {},
    ) {
      return {
        id: 5,
        name: "Nightly job",
        type: EventType.BASH,
        content: "echo hello",
        runLocation,
        serverId: sandbox.id,
        server: sandbox,
        servers: [],
        ...overrides,
      };
    }

    function renderEditing(initialData: ReturnType<typeof directEvent>) {
      const view = render(
        <EventForm initialData={initialData} isEditing eventId={5} />,
      );
      return { user: userEvent.setup(), rerender: view.rerender };
    }

    function ticked(name: string, checked: boolean) {
      return screen.getByRole("checkbox", { name, checked });
    }

    async function saved(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: "Update Event" }));
      await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
      return mockUpdateMutateAsync.mock.calls.at(-1)?.[0] as Record<
        string,
        unknown
      >;
    }

    beforeEach(() => {
      mockActiveServers = [sandbox, otherBox, thirdBox];
    });

    it.each([
      [RunLocation.LOCAL_AND_REMOTE, true],
      [RunLocation.REMOTE, false],
    ])(
      "keeps a %s event on it through an untouched save",
      async (location, onLocal) => {
        const { user } = renderEditing(directEvent(location));

        expect(
          await screen.findByRole("checkbox", {
            name: DIRECT_ROW,
            checked: true,
          }),
        ).toBeInTheDocument();
        expect(ticked(LOCAL_ROW, onLocal)).toBeInTheDocument();
        expect(screen.queryByText(ARCHIVED_NOTICE)).not.toBeInTheDocument();

        expect(await saved(user)).toEqual(
          expect.objectContaining({
            id: 5,
            runLocation: location,
            // The form only writes links, so this is where the direct server goes.
            selectedServerIds: [sandbox.id],
            serverId: null,
          }),
        );
        expect(screen.queryByText(NO_LOCATION)).not.toBeInTheDocument();
      },
    );

    it("does the same for an HTTP request", async () => {
      const { user } = renderEditing(
        directEvent(RunLocation.REMOTE, {
          type: EventType.HTTP_REQUEST,
          content: "",
          httpMethod: "GET",
          httpUrl: "https://example.test/ping",
        }),
      );
      await screen.findByRole("checkbox", { name: DIRECT_ROW, checked: true });

      expect(await saved(user)).toEqual(
        expect.objectContaining({
          runLocation: "REMOTE",
          selectedServerIds: [sandbox.id],
          serverId: null,
        }),
      );
    });

    it("gives it a row when the list didn't return it", async () => {
      // One past the list's limit of 100.
      mockActiveServers = [otherBox];
      const { user } = renderEditing(directEvent(RunLocation.LOCAL_AND_REMOTE));

      const row = await screen.findByRole("checkbox", {
        name: DIRECT_ROW,
        checked: true,
      });
      expect(row).toHaveAttribute("id", "server-6");

      expect(await saved(user)).toEqual(
        expect.objectContaining({
          runLocation: "LOCAL_AND_REMOTE",
          selectedServerIds: [sandbox.id],
        }),
      );
    });

    it("can be unticked, which makes a LOCAL_AND_REMOTE event local", async () => {
      const { user } = renderEditing(directEvent(RunLocation.LOCAL_AND_REMOTE));

      await user.click(
        await screen.findByRole("checkbox", { name: DIRECT_ROW }),
      );

      expect(await saved(user)).toEqual(
        expect.objectContaining({
          runLocation: "LOCAL",
          selectedServerIds: [],
          serverId: null,
        }),
      );
    });

    it("asks for another location once a REMOTE event's only server is unticked", async () => {
      const { user } = renderEditing(directEvent(RunLocation.REMOTE));

      await user.click(
        await screen.findByRole("checkbox", { name: DIRECT_ROW }),
      );
      await user.click(screen.getByRole("button", { name: "Update Event" }));

      expect(await screen.findByText(NO_LOCATION)).toBeInTheDocument();
      expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
    });

    it("can be swapped for another server", async () => {
      const { user } = renderEditing(directEvent(RunLocation.REMOTE));

      await user.click(
        await screen.findByRole("checkbox", { name: DIRECT_ROW }),
      );
      await user.click(screen.getByRole("checkbox", { name: OTHER_ROW }));

      expect((await saved(user)).selectedServerIds).toEqual([otherBox.id]);
    });

    it("can be joined by another server", async () => {
      const { user } = renderEditing(directEvent(RunLocation.REMOTE));
      await screen.findByRole("checkbox", { name: DIRECT_ROW, checked: true });

      await user.click(screen.getByRole("checkbox", { name: OTHER_ROW }));

      expect((await saved(user)).selectedServerIds).toEqual([
        sandbox.id,
        otherBox.id,
      ]);
    });

    it("stays unticked when the same event comes back as a new object", async () => {
      // EventEditTab hands over a new object on every render, and every toast
      // re-renders it. See __tests__/EventEditTab.test.tsx for that wiring.
      const event = directEvent(RunLocation.LOCAL_AND_REMOTE);
      const { user, rerender } = renderEditing(event);
      const row = await screen.findByRole("checkbox", { name: DIRECT_ROW });
      await user.click(row);

      rerender(<EventForm initialData={{ ...event }} isEditing eventId={5} />);

      expect(row).not.toBeChecked();
    });

    it("leaves a LOCAL event's leftover one out, because ticking it would add a server", async () => {
      const { user } = renderEditing(directEvent(RunLocation.LOCAL));

      expect(
        await screen.findByRole("checkbox", {
          name: DIRECT_ROW,
          checked: false,
        }),
      ).toBeInTheDocument();
      expect(ticked(LOCAL_ROW, true)).toBeInTheDocument();

      expect(await saved(user)).toEqual(
        expect.objectContaining({
          runLocation: "LOCAL",
          selectedServerIds: [],
          serverId: null,
        }),
      );
    });

    // Where a job really goes: tests/storage/event-save-direct-server.test.ts.
    describe("alongside links", () => {
      it("takes it over a lone link on a REMOTE event, where a run goes to it", async () => {
        const { user } = renderEditing(
          directEvent(RunLocation.REMOTE, { servers: [otherBox] }),
        );

        await screen.findByRole("checkbox", {
          name: DIRECT_ROW,
          checked: true,
        });
        expect(ticked(OTHER_ROW, false)).toBeInTheDocument();

        expect(await saved(user)).toEqual(
          expect.objectContaining({
            runLocation: "REMOTE",
            selectedServerIds: [sandbox.id],
          }),
        );
      });

      it.each([
        [
          "two links on a REMOTE event",
          RunLocation.REMOTE,
          [otherBox, thirdBox],
          [OTHER_ROW, THIRD_ROW],
        ],
        [
          "a link on a LOCAL_AND_REMOTE event",
          RunLocation.LOCAL_AND_REMOTE,
          [otherBox],
          [OTHER_ROW],
        ],
      ])(
        "leaves it out with %s, where a run skips it",
        async (_label, location, servers, rows) => {
          const { user } = renderEditing(directEvent(location, { servers }));

          await screen.findByRole("checkbox", {
            name: DIRECT_ROW,
            checked: false,
          });
          for (const row of rows) {
            expect(ticked(row, true)).toBeInTheDocument();
          }

          expect(await saved(user)).toEqual(
            expect.objectContaining({
              runLocation: location,
              selectedServerIds: servers.map((server) => server.id),
              serverId: null,
            }),
          );
        },
      );

      it("keeps a server that's both the direct one and a link ticked, once", async () => {
        const { user } = renderEditing(
          directEvent(RunLocation.LOCAL_AND_REMOTE, { servers: [sandbox] }),
        );

        await screen.findByRole("checkbox", {
          name: DIRECT_ROW,
          checked: true,
        });

        expect((await saved(user)).selectedServerIds).toEqual([sandbox.id]);
      });

      it("keeps an archived link ticked beside it, because that link stops the event", async () => {
        const { user } = renderEditing(
          directEvent(RunLocation.REMOTE, { servers: [retiredBox] }),
        );

        await screen.findByRole("checkbox", {
          name: DIRECT_ROW,
          checked: true,
        });
        expect(ticked(ARCHIVED_ROW, true)).toBeInTheDocument();
        expect(screen.getByText(ARCHIVED_NOTICE)).toBeInTheDocument();

        await user.click(screen.getByRole("checkbox", { name: ARCHIVED_ROW }));

        expect(await saved(user)).toEqual(
          expect.objectContaining({
            runLocation: "REMOTE",
            selectedServerIds: [sandbox.id],
          }),
        );
      });
    });
  });
});
