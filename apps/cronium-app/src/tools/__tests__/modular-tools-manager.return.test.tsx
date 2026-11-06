/**
 * Coming back from connecting a tool through OAuth: the page opens on that tool, because
 * its Connect button and its connection state are what the person came back to.
 */
import React from "react";
import { render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

jest.mock("../plugins", () => {
  const plugin = (id: string, name: string) => ({
    id,
    name,
    description: `The ${name} tool`,
    icon: () => null,
    actions: [],
    CredentialForm: () => null,
    CredentialDisplay: () => null,
  });
  const plugins = [plugin("email", "Email"), plugin("google-sheets", "Sheets")];
  return {
    ToolPluginRegistry: {
      getAll: () => plugins,
      get: (id: string) => plugins.find((candidate) => candidate.id === id),
    },
  };
});

jest.mock("../ToolErrorDiagnostics", () => ({
  ToolErrorDiagnostics: () => null,
}));
jest.mock("../templates/ToolActionTemplateForm", () => ({
  ToolActionTemplateForm: () => null,
}));

jest.mock("@/lib/trpc", () => {
  const mutation = { useMutation: () => ({ mutateAsync: jest.fn() }) };
  return {
    trpc: {
      tools: {
        getAll: {
          useQuery: () => ({
            data: { tools: [] },
            isLoading: false,
            refetch: jest.fn(),
          }),
        },
        create: mutation,
        update: mutation,
        delete: mutation,
      },
      toolActionTemplates: {
        getByToolAction: {
          useQuery: () => ({ data: [], refetch: jest.fn() }),
        },
        delete: mutation,
      },
    },
  };
});

import { ModularToolsManager } from "../modular-tools-manager";

function landOn(query: string) {
  window.history.replaceState(null, "", `/dashboard/tools${query}`);
  render(<ModularToolsManager />);
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("ModularToolsManager on the way back from OAuth", () => {
  it("opens on the tool the callback names, in the case it's stored in", () => {
    landOn("?oauth=success&tool=GOOGLE-SHEETS");

    expect(
      screen.getByRole("heading", { name: "Sheets Credentials" }),
    ).toBeInTheDocument();
  });

  it("opens on the first tool on an ordinary visit", () => {
    landOn("");

    expect(
      screen.getByRole("heading", { name: "Email Credentials" }),
    ).toBeInTheDocument();
  });

  it("ignores a tool it doesn't know, rather than showing an empty panel", () => {
    landOn("?tool=no-such-tool");

    expect(
      screen.getByRole("heading", { name: "Email Credentials" }),
    ).toBeInTheDocument();
  });
});
