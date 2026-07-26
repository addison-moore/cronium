/**
 * RTL safety net for the write-only credential contract (AI plugin).
 *
 * REGRESSION (FINDINGS #44): the form used one schema for both modes with
 * `apiKey` optional, so create mode accepted a blank key (rejected only by the
 * server's aiCredentialsSchema, as an error toast). The form now uses the
 * standard split: create mode requires a key (inline error), while edit mode
 * still allows blank — the key is blanked in read responses
 * (lib/tools/credential-redaction.ts) and a blank submit means "keep the
 * current value", never a masked placeholder.
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
    ai: {
      listModels: {
        useMutation: () => ({ mutate: jest.fn(), isPending: false }),
      },
    },
  },
}));

import { AiPlugin } from "../ai-plugin";
import type { ToolWithParsedCredentials } from "@/tools/types/tool-plugin";

const CredentialForm = AiPlugin.CredentialForm;

function makeTool(
  credentials: Record<string, unknown>,
): ToolWithParsedCredentials {
  return {
    id: 9,
    userId: "user-1",
    name: "My OpenAI key",
    type: "AI",
    credentials,
    isActive: true,
    encrypted: true,
    encryptionMetadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

// What the server actually returns for reads: the secret-keyed apiKey is
// blanked, non-secret fields are kept.
const redactedCredentials = {
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  defaultModel: "gpt-4o-mini",
};

describe("AiCredentialForm — write-only secret handling", () => {
  it("renders the API key as a masked password input", () => {
    render(
      <CredentialForm
        tool={null}
        onSubmit={jest.fn().mockResolvedValue(undefined)}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("edit without re-typing the key submits the blank keep-current sentinel (regression)", async () => {
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
    expect(screen.getByLabelText("API Key")).toHaveValue("");

    const name = screen.getByLabelText("Connection Name");
    await user.clear(name);
    await user.type(name, "My OpenAI key (renamed)");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      name: string;
      credentials: Record<string, unknown>;
    };
    expect(payload.name).toBe("My OpenAI key (renamed)");
    // Blank means "keep the stored secret" server-side; a masked placeholder
    // must never be submitted as the new key.
    expect(payload.credentials.apiKey).toBe("");
    expect(payload.credentials.provider).toBe("openai");
    expect(JSON.stringify(payload)).not.toContain("•");
  });

  it("create mode now requires an API key, with an inline error", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(
      <CredentialForm tool={null} onSubmit={onSubmit} onCancel={jest.fn()} />,
    );

    await user.type(screen.getByLabelText("Connection Name"), "New AI");

    // First submit: key still blank — create-mode validation rejects it inline
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("API key is required")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    // Second submit with a key succeeds
    await user.type(screen.getByLabelText("API Key"), "sk-test-123");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      credentials: Record<string, unknown>;
    };
    // Only the second, complete submission got through
    expect(payload.credentials.apiKey).toBe("sk-test-123");
  });
});
