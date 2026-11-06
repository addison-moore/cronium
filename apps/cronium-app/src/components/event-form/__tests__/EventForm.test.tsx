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
        useQuery: () => ({
          data: {
            servers: [{ id: 6, name: "sandbox", address: "192.0.2.10" }],
          },
        }),
      },
      getGroups: {
        useQuery: () => ({ data: { groups: [] } }),
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
import { EventType, EventTriggerType, TimeUnit } from "@/shared/schema";
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
});
