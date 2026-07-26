/**
 * RTL safety net for the write-only credential contract (Trello plugin).
 *
 * REGRESSION (FINDINGS #44): the edit form used the create-mode schema
 * (apiKey/apiToken `min(1)`), so an edit seeded from the redacted DTO (both
 * secret-keyed fields blanked to "" by lib/tools/credential-redaction.ts)
 * could never be submitted without re-typing them — contradicting the
 * server's blank-secret-means-keep-current contract. Edit mode now allows
 * blank for both and submits "" (the keep-current sentinel), never a masked
 * placeholder; create mode still requires both.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/lib/trpc", () => ({
  trpc: {
    tools: {
      testCredentials: {
        useMutation: () => ({ mutate: jest.fn(), isPending: false }),
      },
      testConnection: {
        useMutation: () => ({ mutate: jest.fn(), isPending: false }),
      },
    },
  },
}));

import { TrelloPlugin } from "../trello-plugin";
import type { ToolWithParsedCredentials } from "@/tools/types/tool-plugin";

const CredentialForm = TrelloPlugin.CredentialForm;

function makeTool(
  credentials: Record<string, unknown>,
): ToolWithParsedCredentials {
  return {
    id: 8,
    userId: "user-1",
    name: "Sprint Board",
    type: "TRELLO",
    credentials,
    isActive: true,
    encrypted: true,
    encryptionMetadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

// What the server actually returns for reads: both secret-keyed fields
// (apiKey matches /apikey/, apiToken matches /token/) are blanked.
const redactedCredentials = { apiKey: "", apiToken: "" };

describe("TrelloCredentialForm — write-only secret handling", () => {
  it("renders the API token as a masked password input", () => {
    render(
      <CredentialForm
        tool={null}
        onSubmit={jest.fn().mockResolvedValue(undefined)}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByLabelText("API Token")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("edit without re-typing the secrets submits the blank keep-current sentinels (regression)", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(
      <CredentialForm
        tool={makeTool(redactedCredentials)}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />,
    );

    // Seeded from the redacted DTO: no secret material in either field
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByLabelText("API Token")).toHaveValue("");

    const name = screen.getByLabelText("Configuration Name");
    await user.clear(name);
    await user.type(name, "Sprint Board (renamed)");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      name: string;
      credentials: Record<string, unknown>;
    };
    expect(payload.name).toBe("Sprint Board (renamed)");
    // Blank means "keep the stored secret" server-side; a masked placeholder
    // must never be submitted as a new value.
    expect(payload.credentials.apiKey).toBe("");
    expect(payload.credentials.apiToken).toBe("");
    expect(JSON.stringify(payload)).not.toContain("•");
  });

  it("create mode still requires both the key and the token", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(
      <CredentialForm tool={null} onSubmit={onSubmit} onCancel={jest.fn()} />,
    );

    await user.type(screen.getByLabelText("Configuration Name"), "New Trello");
    await user.type(screen.getByLabelText("API Key"), "key-123");

    // First submit: token still blank — create-mode validation rejects it
    await user.click(screen.getByRole("button", { name: "Create" }));

    // Second submit with a token succeeds
    await user.type(screen.getByLabelText("API Token"), "token-456");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      credentials: Record<string, unknown>;
    };
    // Only the second, complete submission got through
    expect(payload.credentials.apiKey).toBe("key-123");
    expect(payload.credentials.apiToken).toBe("token-456");
  });
});
