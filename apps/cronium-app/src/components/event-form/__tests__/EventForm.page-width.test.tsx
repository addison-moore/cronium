/**
 * An event's Edit tab, and the new event page, have to fit a phone. The script
 * card's header kept its title, Settings and Clear on one line, which needs
 * about 300 px, so at 320 px the page was 328 px wide whatever the event, with
 * Clear past the screen's edge.
 *
 * jsdom has no layout, so this pins what rules the cause out rather than the pixels.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { EventType } from "@/shared/schema";

jest.mock("@/lib/trpc", () => {
  const mutation = { useMutation: () => ({ mutateAsync: jest.fn() }) };
  return {
    trpc: {
      events: {
        validateCron: { useQuery: () => ({ data: undefined }) },
        create: mutation,
        update: mutation,
      },
      servers: {
        getAll: { useQuery: () => ({ data: { servers: [] } }) },
        getGroups: { useQuery: () => ({ data: { groups: [] } }) },
      },
      tools: { getAll: { useQuery: () => ({ data: { tools: [] } }) } },
      settings: {
        getEditorSettings: { useQuery: () => ({ data: undefined }) },
        updateEditorSettings: {
          useMutation: () => ({
            mutate: jest.fn(),
            mutateAsync: jest.fn(),
            isPending: false,
          }),
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
    MonacoEditor: () =>
      ReactActual.createElement("textarea", { readOnly: true }),
  };
});

jest.mock("@/components/dashboard/AIScriptAssistant-lazy", () => ({
  __esModule: true,
  default: () => null,
}));

import EventForm from "../EventForm";

describe("what can't widen the event form", () => {
  it("lets Settings and Clear go under the script card's title", () => {
    render(
      <EventForm initialData={{ type: EventType.BASH, content: "echo hi" }} />,
    );

    const title = screen.getByText("Script Content");
    const clear = screen.getByRole("button", { name: "Clear" });
    let row = clear.parentElement!;
    while (!row.contains(title)) row = row.parentElement!;
    expect(row).toHaveClass("flex", "flex-wrap");
    expect(row).toContainElement(
      screen.getByRole("button", { name: "Settings" }),
    );
  });
});
