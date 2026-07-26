/**
 * RTL safety net for the write-only credential contract (Email plugin).
 *
 * Pins:
 * - the SMTP password renders as <input type="password">;
 * - the credential display masks the password behind bullets by default and
 *   only ever reveals what the server sent (which is "" in production — read
 *   responses are redacted by lib/tools/credential-redaction.ts);
 * - REGRESSION for a real bug fixed alongside this test: the edit form used
 *   the create-mode schema (smtpPassword min(1)), so an edit seeded from the
 *   redacted DTO could never be submitted without re-typing the password —
 *   contradicting the server's blank-secret-means-keep-current contract.
 *   Edit mode now allows a blank password and submits "" (the keep-current
 *   sentinel), never a masked placeholder;
 * - create mode still requires a password.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
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

import { EmailPlugin } from "../email-plugin";
import type { ToolWithParsedCredentials } from "@/tools/types/tool-plugin";

const CredentialForm = EmailPlugin.CredentialForm;
const CredentialDisplay = EmailPlugin.CredentialDisplay;

function makeTool(
  credentials: Record<string, unknown>,
): ToolWithParsedCredentials {
  return {
    id: 3,
    userId: "user-1",
    name: "Work Email",
    type: "EMAIL",
    credentials,
    isActive: true,
    encrypted: true,
    encryptionMetadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

// What the server actually returns for reads: secret keys blanked.
const redactedCredentials = {
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUser: "mailer@example.com",
  smtpPassword: "",
  fromEmail: "noreply@example.com",
  fromName: "Cronium",
  enableTLS: true,
  enableSSL: false,
};

describe("EmailCredentialForm — write-only secret handling", () => {
  it("renders the SMTP password as a masked password input", () => {
    render(
      <CredentialForm
        tool={null}
        onSubmit={jest.fn().mockResolvedValue(undefined)}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("edit without re-typing the password submits the blank keep-current sentinel (regression)", async () => {
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
    expect(screen.getByLabelText("Password")).toHaveValue("");

    const fromName = screen.getByLabelText("From Name");
    await user.clear(fromName);
    await user.type(fromName, "Cronium Alerts");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      name: string;
      credentials: Record<string, unknown>;
    };
    expect(payload.credentials.fromName).toBe("Cronium Alerts");
    // Blank means "keep the stored secret" server-side; a masked placeholder
    // must never be submitted as the new password.
    expect(payload.credentials.smtpPassword).toBe("");
    expect(JSON.stringify(payload)).not.toContain("•");
  });

  it("create mode still requires a password", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(
      <CredentialForm tool={null} onSubmit={onSubmit} onCancel={jest.fn()} />,
    );

    await user.type(screen.getByLabelText("Configuration Name"), "New SMTP");
    await user.type(screen.getByLabelText("SMTP Host"), "smtp.example.com");
    await user.type(screen.getByLabelText("SMTP User"), "mailer");
    await user.type(screen.getByLabelText("From Email"), "noreply@example.com");

    // First submit: password still blank — create-mode validation rejects it
    await user.click(screen.getByRole("button", { name: "Create" }));

    // Second submit with a password succeeds
    await user.type(screen.getByLabelText("Password"), "app-password-123");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      credentials: Record<string, unknown>;
    };
    // Only the second, complete submission got through
    expect(payload.credentials.smtpPassword).toBe("app-password-123");
  });
});

describe("EmailCredentialDisplay — masked by default", () => {
  it("shows bullets instead of the password and only reveals on demand", async () => {
    const user = userEvent.setup();
    // Defense-in-depth fixture: production DTOs arrive redacted ("") — the
    // reveal toggle can therefore only ever expose an empty string. A
    // sentinel proves the default view masks whatever the server sent.
    const { container } = render(
      <CredentialDisplay
        tools={[
          makeTool({ ...redactedCredentials, smtpPassword: "S3NTINEL-PW" }),
        ]}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("S3NTINEL-PW");

    // The eye toggle reveals the server-provided value (redacted "" in prod)
    const passwordRow = screen.getByText("Password:").closest("div")!;
    await user.click(within(passwordRow).getByRole("button"));
    expect(screen.getByText("S3NTINEL-PW")).toBeInTheDocument();
    expect(screen.queryByText("••••••••")).not.toBeInTheDocument();
  });
});
