/**
 * RTL safety net for the write-only credential contract (Slack plugin).
 *
 * REGRESSION (FINDINGS #44): the edit form used the create-mode schema
 * (webhookUrl `.url()` + host check), so an edit seeded from the redacted DTO
 * (webhookUrl blanked to "" by lib/tools/credential-redaction.ts) could never
 * be submitted without re-pasting the webhook URL — contradicting the server's
 * blank-secret-means-keep-current contract. Edit mode now allows blank and
 * submits "" (the keep-current sentinel), never a masked placeholder; a
 * non-blank replacement is still fully validated, and create mode still
 * requires a valid hooks.slack.com URL.
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

import { SlackPluginTrpc } from "../slack-plugin";
import type { ToolWithParsedCredentials } from "@/tools/types/tool-plugin";

const CredentialForm = SlackPluginTrpc.CredentialForm;

function makeTool(
  credentials: Record<string, unknown>,
): ToolWithParsedCredentials {
  return {
    id: 4,
    userId: "user-1",
    name: "Team Slack",
    type: "SLACK",
    credentials,
    isActive: true,
    encrypted: true,
    encryptionMetadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

// What the server actually returns for reads: the secret-keyed webhookUrl is
// blanked.
const redactedCredentials = { webhookUrl: "" };

describe("SlackCredentialForm — write-only secret handling", () => {
  it("edit without re-typing the webhook URL submits the blank keep-current sentinel (regression)", async () => {
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
    expect(screen.getByLabelText("Webhook URL")).toHaveValue("");

    const name = screen.getByLabelText("Configuration Name");
    await user.clear(name);
    await user.type(name, "Team Slack (renamed)");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      name: string;
      credentials: Record<string, unknown>;
    };
    expect(payload.name).toBe("Team Slack (renamed)");
    // Blank means "keep the stored secret" server-side; a masked placeholder
    // must never be submitted as the new URL.
    expect(payload.credentials.webhookUrl).toBe("");
    expect(JSON.stringify(payload)).not.toContain("•");
  });

  it("edit mode still validates a non-blank replacement URL", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(
      <CredentialForm
        tool={makeTool(redactedCredentials)}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Webhook URL"), "not-a-url");
    await user.click(screen.getByRole("button", { name: "Update" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("create mode still requires a valid hooks.slack.com webhook URL", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(
      <CredentialForm tool={null} onSubmit={onSubmit} onCancel={jest.fn()} />,
    );

    await user.type(screen.getByLabelText("Configuration Name"), "New Slack");

    // First submit: URL still blank — create-mode validation rejects it
    await user.click(screen.getByRole("button", { name: "Create" }));

    // Second submit with a valid URL succeeds
    const url = "https://hooks.slack.com/services/T000/B000/XXXX";
    await user.type(screen.getByLabelText("Webhook URL"), url);
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      credentials: Record<string, unknown>;
    };
    // Only the second, complete submission got through
    expect(payload.credentials.webhookUrl).toBe(url);
  });
});
