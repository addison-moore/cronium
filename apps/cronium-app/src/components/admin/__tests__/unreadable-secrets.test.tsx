/**
 * What the admin forms show for a saved secret the server can't decrypt. Leaving the
 * field blank keeps the old value, so "leave blank to keep" is the wrong thing to say
 * when the old value can't be used. tests/storage/unreadable-settings.test.ts covers
 * what the server reports.
 */
import React from "react";
import { render, screen } from "@testing-library/react";

const mockListedModels = {
  models: [] as Array<{ id: string; name: string }>,
  source: "fallback",
  error: undefined as string | undefined,
};

jest.mock("@/lib/trpc", () => ({
  trpc: {
    admin: {
      listAiModels: {
        useMutation: (options: { onSuccess: (r: unknown) => void }) => ({
          mutate: () => options.onSuccess({ data: mockListedModels }),
          isPending: false,
        }),
      },
    },
  },
}));

import { AiSettings } from "../ai-settings";
import { SmtpSettings } from "../smtp-settings";

const onSave = jest.fn(() => Promise.resolve());

beforeEach(() => {
  mockListedModels.error = undefined;
});

describe("SmtpSettings", () => {
  it("says the saved password can't be read, in place of offering to keep it", () => {
    render(
      <SmtpSettings
        settings={{ unreadableSecrets: ["smtpPassword"] }}
        onSave={onSave}
      />,
    );

    const notice = screen.getByText(/saved password can't be decrypted/);
    expect(notice).toHaveTextContent("email can't be sent");
    expect(notice).toHaveTextContent("Enter the password again and save");
    expect(screen.queryByText(/Leave this blank/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("SMTP Password")).toHaveAttribute(
      "aria-describedby",
      notice.id,
    );
  });

  it("keeps the usual hint otherwise, including for an AI key that can't be read", () => {
    render(
      <SmtpSettings
        settings={{ unreadableSecrets: ["openaiApiKey"] }}
        onSave={onSave}
      />,
    );

    expect(screen.getByText(/Leave this blank/)).toBeInTheDocument();
    expect(screen.queryByText(/can't be decrypted/)).not.toBeInTheDocument();
  });

  it("keeps the usual hint when the server sends no list", () => {
    render(<SmtpSettings settings={{}} onSave={onSave} />);

    expect(screen.getByText(/Leave this blank/)).toBeInTheDocument();
  });
});

describe("AiSettings", () => {
  it("says the selected provider's saved key can't be read", () => {
    render(
      <AiSettings
        settings={{
          aiEnabled: true,
          aiProvider: "anthropic",
          aiModel: "claude-sonnet-5",
          unreadableSecrets: ["anthropicApiKey"],
        }}
        onSave={onSave}
      />,
    );

    const notice = screen.getByText(/saved key can't be decrypted/);
    expect(notice).toHaveTextContent("Enter the key again and save");
    expect(screen.queryByText(/Leave blank/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Anthropic API Key")).toHaveAttribute(
      "aria-describedby",
      notice.id,
    );
  });

  it("says nothing about another provider's key", () => {
    render(
      <AiSettings
        settings={{
          aiEnabled: true,
          aiProvider: "anthropic",
          aiModel: "claude-sonnet-5",
          unreadableSecrets: ["openaiApiKey", "smtpPassword"],
        }}
        onSave={onSave}
      />,
    );

    expect(screen.getByText(/Leave blank/)).toBeInTheDocument();
    expect(screen.queryByText(/can't be decrypted/)).not.toBeInTheDocument();
  });

  it("shows why it couldn't list models, without calling it a provider's error", () => {
    mockListedModels.error =
      "The saved Anthropic API key can't be decrypted, so it can't be used.";

    render(
      <AiSettings
        settings={{
          aiEnabled: true,
          aiProvider: "anthropic",
          aiModel: "claude-sonnet-5",
          unreadableSecrets: ["anthropicApiKey"],
        }}
        onSave={onSave}
      />,
    );

    const reason = screen.getByText(/Couldn't fetch the live model list/);
    expect(reason).toHaveTextContent(mockListedModels.error);
    expect(reason).not.toHaveTextContent("Provider error");
  });
});
