/**
 * RTL safety net for the write-only credential contract (SQL plugin).
 *
 * The server redacts secret-keyed credential values to "" in every read
 * response (lib/tools/credential-redaction.ts) and treats a blank secret on
 * update as "keep the current value". These tests pin the client half of the
 * contract:
 * - secret fields render as <input type="password">, never plain text;
 * - an edit form seeded from a redacted DTO shows no secret material;
 * - submitting an edit without touching the password sends "" (the
 *   keep-current sentinel), not a masked placeholder or plaintext;
 * - the credential list/display never prints the password at all.
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

import { SqlPlugin } from "../sql-plugin";
import type { ToolWithParsedCredentials } from "@/tools/types/tool-plugin";

const CredentialForm = SqlPlugin.CredentialForm;
const CredentialDisplay = SqlPlugin.CredentialDisplay;

function makeTool(
  credentials: Record<string, unknown>,
): ToolWithParsedCredentials {
  return {
    id: 7,
    userId: "user-1",
    name: "Analytics DB",
    type: "SQL",
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
  dialect: "postgres",
  host: "db.example.com",
  port: 5432,
  database: "analytics",
  user: "readonly",
  password: "",
  ssl: "require",
};

describe("SqlCredentialForm — write-only secret handling", () => {
  it("renders the password as a masked password input", () => {
    render(
      <CredentialForm
        tool={null}
        onSubmit={jest.fn().mockResolvedValue(undefined)}
        onCancel={jest.fn()}
      />,
    );

    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("placeholder", "••••••••");
  });

  it("seeds the edit form from the redacted DTO — the password field is empty", () => {
    render(
      <CredentialForm
        tool={makeTool(redactedCredentials)}
        onSubmit={jest.fn().mockResolvedValue(undefined)}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByLabelText("Password")).toHaveValue("");
    // Non-secret fields keep their values for editing
    expect(screen.getByLabelText("Host")).toHaveValue("db.example.com");
    expect(screen.getByLabelText("User")).toHaveValue("readonly");
  });

  it("submitting an edit without touching the password sends the blank keep-current sentinel", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);

    render(
      <CredentialForm
        tool={makeTool(redactedCredentials)}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />,
    );

    const host = screen.getByLabelText("Host");
    await user.clear(host);
    await user.type(host, "db2.example.com");
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]![0] as {
      name: string;
      credentials: Record<string, unknown>;
    };
    expect(payload.name).toBe("Analytics DB");
    expect(payload.credentials.host).toBe("db2.example.com");
    // Blank means "keep the stored secret" server-side — the client must not
    // substitute a masked placeholder (or any other value) for it.
    expect(payload.credentials.password).toBe("");
    expect(JSON.stringify(payload)).not.toContain("•");
  });
});

describe("SqlCredentialDisplay — no secret material in the DOM", () => {
  it("never renders the password value, even if one were present in the DTO", () => {
    // Defense-in-depth fixture: production DTOs arrive redacted, but the
    // display must not print the password either way.
    const { container } = render(
      <CredentialDisplay
        tools={[makeTool({ ...redactedCredentials, password: "S3NTINEL-PW" })]}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.queryByText(/S3NTINEL-PW/)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("S3NTINEL-PW");
    // The rest of the connection summary is still shown
    expect(
      screen.getByText(/readonly@db\.example\.com:5432\/analytics/),
    ).toBeInTheDocument();
  });
});
