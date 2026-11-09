/**
 * The Enable TLS box stops a send or a test that can't switch to TLS, and the message
 * then says to untick it to use that server unencrypted. So the box says what it does,
 * and unticking it on a saved credential really saves it unticked.
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

import { EmailPlugin } from "../email-plugin";
import type { ToolWithParsedCredentials } from "@/tools/types/tool-plugin";

const CredentialForm = EmailPlugin.CredentialForm;

const savedTool: ToolWithParsedCredentials = {
  id: 3,
  userId: "user-1",
  name: "Office relay",
  type: "EMAIL",
  // As a read returns it, with the password blanked.
  credentials: {
    smtpHost: "relay.internal.example",
    smtpPort: 25,
    smtpUser: "mailer",
    smtpPassword: "",
    fromEmail: "noreply@example.com",
    fromName: "Cronium",
    enableTLS: true,
    enableSSL: false,
  },
  isActive: true,
  encrypted: true,
  encryptionMetadata: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

it("is ticked for a new credential and says what it does", () => {
  render(
    <CredentialForm tool={null} onSubmit={jest.fn()} onCancel={jest.fn()} />,
  );

  const box = screen.getByRole("checkbox", { name: "Enable TLS" });
  expect(box).toBeChecked();
  expect(box).toHaveAccessibleDescription(
    "Cronium signs in and sends only after the server switches to TLS with STARTTLS.",
  );
});

it("saves a credential unticked when it's unticked", async () => {
  const user = userEvent.setup();
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(
    <CredentialForm
      tool={savedTool}
      onSubmit={onSubmit}
      onCancel={jest.fn()}
    />,
  );

  await user.click(screen.getByRole("checkbox", { name: "Enable TLS" }));
  await user.click(screen.getByRole("button", { name: "Update" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const { credentials } = onSubmit.mock.calls[0]![0] as {
    credentials: Record<string, unknown>;
  };
  expect(credentials.enableTLS).toBe(false);
  expect(credentials.enableSSL).toBe(false);
});
