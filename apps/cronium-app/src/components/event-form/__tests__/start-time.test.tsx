/**
 * The start time field in a browser that isn't on UTC. An event stores one instant. The
 * field shows it in the browser's zone and reads what's typed the same way, so opening
 * an event and saving it changes nothing.
 *
 * Every test here sets its zone, because Jest's isn't fixed: on CI it's UTC, the one zone
 * where getting this wrong can't show.
 */
import React from "react";
import { runInThisContext } from "node:vm";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUpdateMutateAsync = jest.fn();

jest.mock("@/lib/trpc", () => ({
  trpc: {
    events: {
      validateCron: {
        useQuery: () => ({ data: undefined }),
      },
      create: {
        useMutation: () => ({ mutateAsync: jest.fn() }),
      },
      update: {
        useMutation: () => ({ mutateAsync: mockUpdateMutateAsync }),
      },
    },
    servers: {
      getAll: {
        useQuery: () => ({ data: { servers: [] } }),
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

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<typeof import("@cronium/ui")>("@cronium/ui"),
  useToast: () => ({ toast: jest.fn() }),
  MonacoEditor: () => null,
}));

jest.mock("@/components/dashboard/AIScriptAssistant-lazy", () => ({
  __esModule: true,
  default: () => null,
}));

import EventForm from "../EventForm";
import { buildEventFormDefaults } from "../lib/event-form-defaults";
import { buildEventPayload } from "../lib/event-payload";
import { EventTriggerType, EventType } from "@/shared/schema";

// Jest gives a test a copy of process.env, and setting TZ on a copy changes nothing. Node
// re-reads the zone when the real one is set.
const realEnv = (runInThisContext("process") as NodeJS.Process).env;

function inTimeZone(zone: string) {
  const machineZone = realEnv.TZ;
  beforeAll(() => {
    realEnv.TZ = zone;
  });
  afterAll(() => {
    if (machineZone === undefined) delete realEnv.TZ;
    else realEnv.TZ = machineZone;
  });
}

/** What the field shows for a stored time. */
function shownFor(stored: string) {
  return buildEventFormDefaults({ startTime: new Date(stored) }).startTime;
}

/** What a save sends after the field was left holding `value`. */
function savedFrom(value: string | null, stored?: string) {
  return buildEventPayload(
    { ...buildEventFormDefaults(), startTime: value },
    stored ? new Date(stored) : undefined,
  ).startTime;
}

/** What opening an event and pressing save sends. */
function savedUntouched(stored: string) {
  return savedFrom(shownFor(stored), stored);
}

const STORED = "2027-03-04T05:06:00.000Z";
const STORED_WITH_SECONDS = "2027-03-04T05:06:30.500Z";

describe.each([
  ["UTC", "2027-03-04T05:06"],
  // Behind UTC, so on the day before
  ["America/Los_Angeles", "2027-03-03T21:06"],
  // A half-hour offset
  ["Asia/Kolkata", "2027-03-04T10:36"],
  // As far ahead as zones go
  ["Pacific/Kiritimati", "2027-03-04T19:06"],
])("in %s", (zone, shown) => {
  inTimeZone(zone);

  it("shows the stored time in that zone", () => {
    expect(shownFor(STORED)).toBe(shown);
  });

  it("takes a stored time given as a string", () => {
    const stored = STORED_WITH_SECONDS;
    const startTime = buildEventFormDefaults({
      startTime: stored as never,
    }).startTime;
    expect(startTime).toBe(shown);
    expect(
      buildEventPayload({ ...buildEventFormDefaults(), startTime }, stored)
        .startTime,
    ).toBe(stored);
  });

  it("reads a time typed into the field as that zone's", () => {
    expect(savedFrom(shown)).toBe(STORED);
  });

  it.each([
    ["on the minute", STORED],
    ["with seconds", STORED_WITH_SECONDS],
  ])("keeps a time %s through untouched saves", (_name, stored) => {
    const first = savedUntouched(stored);
    expect(first).toBe(stored);
    expect(savedUntouched(first!)).toBe(stored);
  });
});

describe("around the clocks changing, in America/Los_Angeles", () => {
  inTimeZone("America/Los_Angeles");

  it("uses the offset on that date, not today's", () => {
    // Winter is 8 hours behind, summer 7.
    expect(shownFor("2027-01-04T05:06:00.000Z")).toBe("2027-01-03T21:06");
    expect(shownFor("2027-07-04T05:06:00.000Z")).toBe("2027-07-03T22:06");
  });

  // Clocks go back at 02:00 on 2027-11-07, so 01:30 happens twice that morning. The
  // string can only be read as the first of the two.
  it.each([
    ["first", "2027-11-07T08:30:00.000Z"],
    ["second", "2027-11-07T09:30:00.000Z"],
  ])("keeps the %s 01:30 of the hour they repeat", (_name, stored) => {
    expect(shownFor(stored)).toBe("2027-11-07T01:30");
    expect(savedUntouched(stored)).toBe(stored);
  });
});

describe("after the field changes, in America/Los_Angeles", () => {
  inTimeZone("America/Los_Angeles");

  it("saves the new time", () => {
    expect(savedFrom("2027-03-03T22:00", STORED_WITH_SECONDS)).toBe(
      "2027-03-04T06:00:00.000Z",
    );
  });

  it("keeps the stored time when changed back to it", () => {
    expect(savedFrom("2027-03-03T21:06", STORED_WITH_SECONDS)).toBe(
      STORED_WITH_SECONDS,
    );
  });

  it("saves a time set on an event that had none", () => {
    expect(savedFrom("2027-03-03T21:06")).toBe(STORED);
  });

  it("saves nothing once it's cleared", () => {
    expect(savedFrom("", STORED)).toBeNull();
    expect(savedFrom(null, STORED)).toBeNull();
  });
});

describe("the form, in America/Los_Angeles", () => {
  inTimeZone("America/Los_Angeles");

  const event = {
    type: EventType.BASH,
    content: "echo hello",
    triggerType: EventTriggerType.SCHEDULE,
    name: "Nightly",
    startTime: new Date(STORED_WITH_SECONDS),
  };

  const startTimeField = () => screen.getByLabelText("Start Time (Optional)");

  async function save() {
    await userEvent.click(screen.getByRole("button", { name: "Update Event" }));
    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1));
    return (mockUpdateMutateAsync.mock.calls[0]?.[0] as { startTime: unknown })
      .startTime;
  }

  beforeEach(() => {
    mockUpdateMutateAsync.mockReset().mockResolvedValue({ id: 7 });
  });

  it("shows the browser's time and says which zone that is", () => {
    render(<EventForm initialData={event} isEditing eventId={7} />);

    expect(startTimeField()).toHaveValue("2027-03-03T21:06");
    expect(
      screen.getByText(/your browser's timezone \(America\/Los_Angeles\)/),
    ).toBeInTheDocument();
  });

  it("leaves the time alone on an untouched save", async () => {
    render(<EventForm initialData={event} isEditing eventId={7} />);

    expect(await save()).toBe(STORED_WITH_SECONDS);
  });

  it("saves a new time as this zone's", async () => {
    render(<EventForm initialData={event} isEditing eventId={7} />);

    fireEvent.change(startTimeField(), {
      target: { value: "2027-03-03T22:00" },
    });

    expect(await save()).toBe("2027-03-04T06:00:00.000Z");
  });

  it("doesn't read it in the zone cron schedules use", async () => {
    render(
      <EventForm
        initialData={{
          ...event,
          customSchedule: "0 3 * * 1",
          timezone: "Asia/Tokyo",
        }}
        isEditing
        eventId={7}
      />,
    );

    expect(startTimeField()).toHaveValue("2027-03-03T21:06");
    expect(await save()).toBe(STORED_WITH_SECONDS);
  });
});
