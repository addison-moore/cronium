/**
 * RTL safety net for the write-only credential contract (Notion plugin).
 *
 * REGRESSION (FINDINGS #44): the edit form used the create-mode schema
 * (apiKey `min(1)`), so an edit seeded from the redacted DTO (apiKey blanked
 * to "" by lib/tools/credential-redaction.ts) could never be submitted without
 * re-typing the integration token — contradicting the server's
 * blank-secret-means-keep-current contract. Edit mode now allows blank and
 * submits "" (the keep-current sentinel), never a masked placeholder; create
 * mode still requires a token.
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

import { NotionPlugin } from "../notion-plugin";
import type { ToolWithParsedCredentials } from "@/tools/types/tool-plugin";

const CredentialForm = NotionPlugin.CredentialForm;

function makeTool(
  credentials: Record<string, unknown>,
): ToolWithParsedCredentials {
  return {
    id: 6,
    userId: "user-1",
    name: "Docs Workspace",
    type: "NOTION",
    credentials,
    isActive: true,
    encrypted: true,
    encryptionMetadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

// What the server actually returns for reads: the secret-keyed apiKey is
// blanked.
const redactedCredentials = { apiKey: "" };

describe("NotionCredentialForm — write-only secret handling", () => {
  it("renders the integration token as a masked password input", () => {
    render(
      <CredentialForm
        tool={null}
        onSubmit={jest.fn().mockResolvedValue(undefined)}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByLabelText("Integration Token")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("edit without re-typing the token submits the blank keep-current sentinel (regression)", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(
      <CredentialForm
        tool={makeTool(redactedCredentials)}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />,
    );

    // Seeded from the redacted DTO: no secret material in the field
    expect(screen.getByLabelText("Integration Token")).toHaveValue("");

    const name = screen.getByLabelText("Configuration Name");
    await user.clear(name);
    await user.type(name, "Docs Workspace (renamed)");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      name: string;
      credentials: Record<string, unknown>;
    };
    expect(payload.name).toBe("Docs Workspace (renamed)");
    // Blank means "keep the stored secret" server-side; a masked placeholder
    // must never be submitted as the new token.
    expect(payload.credentials.apiKey).toBe("");
    expect(JSON.stringify(payload)).not.toContain("•");
  });

  it("create mode still requires a token", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(
      <CredentialForm tool={null} onSubmit={onSubmit} onCancel={jest.fn()} />,
    );

    await user.type(screen.getByLabelText("Configuration Name"), "New Notion");

    // First submit: token still blank — create-mode validation rejects it
    await user.click(screen.getByRole("button", { name: "Create" }));

    // Second submit with a token succeeds
    await user.type(
      screen.getByLabelText("Integration Token"),
      "secret_abc123",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      credentials: Record<string, unknown>;
    };
    // Only the second, complete submission got through
    expect(payload.credentials.apiKey).toBe("secret_abc123");
  });
});
