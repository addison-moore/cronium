/**
 * The note on an event that runs only on servers and has none. Someone else's
 * shared event comes with its servers left out, so it mustn't say that of theirs.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { EventStatus, EventType, RunLocation } from "@/shared/schema";
import { EventOverviewTab } from "../EventOverviewTab";
import type { Event } from "../types";

jest.mock("../WorkflowsCard", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../ScheduleIncidentsCard", () => ({
  ScheduleIncidentsCard: () => null,
}));

function renderEvent(overrides: Partial<Event>) {
  render(
    <EventOverviewTab
      event={
        {
          id: 1,
          name: "the event",
          type: EventType.BASH,
          status: EventStatus.PAUSED,
          content: "echo hi",
          scheduleNumber: 1,
          scheduleUnit: "MINUTES",
          customSchedule: null,
          timeoutValue: 30,
          timeoutUnit: "SECONDS",
          retries: 0,
          createdAt: "2026-11-05T00:00:00.000Z",
          updatedAt: "2026-11-05T00:00:00.000Z",
          lastRunAt: null,
          nextRunAt: null,
          servers: [],
          ...overrides,
        } as Event
      }
      onResetCounter={jest.fn()}
      isResettingCounter={false}
    />,
  );
}

const note = () => screen.queryByText("(no servers)");

describe("the no-servers note", () => {
  it("shows on a REMOTE script with no servers", () => {
    renderEvent({ runLocation: RunLocation.REMOTE });
    expect(note()).toBeInTheDocument();
  });

  it("doesn't show on someone else's event, whose servers are left out", () => {
    renderEvent({
      runLocation: RunLocation.REMOTE,
      secretFieldsRedacted: true,
    });
    expect(note()).not.toBeInTheDocument();
  });

  it("doesn't show when the event has a direct server", () => {
    renderEvent({ runLocation: RunLocation.REMOTE, serverId: 5 });
    expect(note()).not.toBeInTheDocument();
  });

  it("doesn't show on a LOCAL_AND_REMOTE event, which still runs locally", () => {
    renderEvent({ runLocation: RunLocation.LOCAL_AND_REMOTE });
    expect(note()).not.toBeInTheDocument();
  });

  it("doesn't show on a REMOTE HTTP request, which runs in the worker", () => {
    renderEvent({
      runLocation: RunLocation.REMOTE,
      type: EventType.HTTP_REQUEST,
    });
    expect(note()).not.toBeInTheDocument();
  });
});
