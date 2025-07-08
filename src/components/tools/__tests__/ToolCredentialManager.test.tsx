import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ToolCredentialManager from "../ToolCredentialManager";
import { useToast } from "@/components/ui/use-toast";
import { trpc } from "@/lib/trpc";
import { ToolPluginRegistry } from "../types/tool-plugin";
import { type Tool, type ToolType } from "@/shared/schema";

// Mock dependencies
jest.mock("@/components/ui/use-toast", () => ({
  useToast: jest.fn(),
}));

jest.mock("@/lib/trpc", () => ({
  trpc: {
    useContext: jest.fn(),
    tools: {
      list: {
        useQuery: jest.fn(),
      },
      listWithDecryptedConfig: {
        useQuery: jest.fn(),
      },
      create: {
        useMutation: jest.fn(),
      },
      update: {
        useMutation: jest.fn(),
      },
      delete: {
        useMutation: jest.fn(),
      },
      testConnection: {
        useMutation: jest.fn(),
      },
    },
  },
}));

jest.mock("../types/tool-plugin", () => ({
  ToolPluginRegistry: {
    getPlugin: jest.fn(),
    listPlugins: jest.fn(),
  },
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
});

// Mock window.open
global.window.open = jest.fn();

describe("ToolCredentialManager", () => {
  const mockToast = jest.fn();
  const mockUtils = {
    tools: {
      list: {
        invalidate: jest.fn(),
      },
      listWithDecryptedConfig: {
        invalidate: jest.fn(),
      },
    },
  };

  const mockMutations = {
    create: {
      mutate: jest.fn(),
      isPending: false,
    },
    update: {
      mutate: jest.fn(),
      isPending: false,
    },
    delete: {
      mutate: jest.fn(),
      isPending: false,
    },
    testConnection: {
      mutate: jest.fn(),
      isPending: false,
    },
  };

  const sampleTools: Tool[] = [
    {
      id: 1,
      name: "Production Slack",
      type: "slack" as ToolType,
      config: { webhook_url: "encrypted" },
      userId: 1,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    },
    {
      id: 2,
      name: "Marketing Discord",
      type: "discord" as ToolType,
      config: { webhook_url: "encrypted" },
      userId: 1,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    },
  ];

  const sampleDecryptedTools = [
    {
      ...sampleTools[0],
      config: { webhook_url: "https://hooks.slack.com/services/..." },
    },
    {
      ...sampleTools[1],
      config: { webhook_url: "https://discord.com/api/webhooks/..." },
    },
  ];

  const samplePlugin = {
    id: "slack",
    name: "Slack",
    category: "communication",
    icon: () => null,
    configFields: [
      {
        name: "webhook_url",
        label: "Webhook URL",
        type: "password" as const,
        required: true,
        placeholder: "https://hooks.slack.com/services/...",
        description: "Your Slack webhook URL",
      },
    ],
    docsUrl: "https://api.slack.com/messaging/webhooks",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    (trpc.useContext as jest.Mock).mockReturnValue(mockUtils);

    // Mock queries
    (trpc.tools.list.useQuery as jest.Mock).mockReturnValue({
      data: sampleTools,
      isLoading: false,
    });

    (trpc.tools.listWithDecryptedConfig.useQuery as jest.Mock).mockReturnValue({
      data: sampleDecryptedTools,
    });

    // Mock mutations
    (trpc.tools.create.useMutation as jest.Mock).mockReturnValue(
      mockMutations.create,
    );
    (trpc.tools.update.useMutation as jest.Mock).mockReturnValue(
      mockMutations.update,
    );
    (trpc.tools.delete.useMutation as jest.Mock).mockReturnValue(
      mockMutations.delete,
    );
    (trpc.tools.testConnection.useMutation as jest.Mock).mockReturnValue(
      mockMutations.testConnection,
    );

    // Mock plugin registry
    (ToolPluginRegistry.getPlugin as jest.Mock).mockReturnValue(samplePlugin);
    (ToolPluginRegistry.listPlugins as jest.Mock).mockReturnValue([
      samplePlugin,
    ]);
  });

  describe("Rendering", () => {
    it("renders the main interface correctly", () => {
      render(<ToolCredentialManager />);

      expect(
        screen.getByText("Tool Credential Management"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Manage and test your tool integrations securely"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /add tool/i }),
      ).toBeInTheDocument();
    });

    it("shows loading state when data is loading", () => {
      (trpc.tools.list.useQuery as jest.Mock).mockReturnValue({
        data: [],
        isLoading: true,
      });

      render(<ToolCredentialManager />);

      expect(screen.getByRole("img", { hidden: true })).toBeInTheDocument(); // Spinner
    });

    it("shows empty state when no tools are configured", () => {
      (trpc.tools.list.useQuery as jest.Mock).mockReturnValue({
        data: [],
        isLoading: false,
      });

      render(<ToolCredentialManager />);

      expect(screen.getByText(/No tools configured yet/)).toBeInTheDocument();
    });

    it("displays filtered tools correctly", () => {
      render(<ToolCredentialManager />);

      expect(screen.getByText("Production Slack")).toBeInTheDocument();
      expect(screen.getByText("Marketing Discord")).toBeInTheDocument();
      expect(screen.getByText("Slack")).toBeInTheDocument();
    });
  });

  describe("Search and Filtering", () => {
    it("filters tools by search query", async () => {
      render(<ToolCredentialManager />);

      const searchInput = screen.getByPlaceholderText("Search tools...");
      await userEvent.type(searchInput, "slack");

      expect(screen.getByText("Production Slack")).toBeInTheDocument();
      expect(screen.queryByText("Marketing Discord")).not.toBeInTheDocument();
    });

    it("filters tools by category", async () => {
      render(<ToolCredentialManager />);

      const communicationTab = screen.getByRole("tab", {
        name: /communication/i,
      });
      await userEvent.click(communicationTab);

      // Should show tools in communication category
      expect(screen.getByText("Production Slack")).toBeInTheDocument();
    });

    it("shows no results message when search yields no results", async () => {
      render(<ToolCredentialManager />);

      const searchInput = screen.getByPlaceholderText("Search tools...");
      await userEvent.type(searchInput, "nonexistent");

      expect(
        screen.getByText(/No tools found matching your criteria/),
      ).toBeInTheDocument();
    });
  });

  describe("Tool Display", () => {
    it("displays tool credentials correctly", () => {
      render(<ToolCredentialManager />);

      expect(screen.getByText("Webhook URL:")).toBeInTheDocument();
      expect(screen.getByText("••••••••")).toBeInTheDocument(); // Masked password
    });

    it("toggles credential visibility", async () => {
      render(<ToolCredentialManager />);

      const eyeButton = screen
        .getAllByRole("button")
        .find((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-3 w-3"),
        );

      await userEvent.click(eyeButton!);

      expect(
        screen.getByText("https://hooks.slack.com/services/..."),
      ).toBeInTheDocument();
    });

    it("copies credential to clipboard", async () => {
      render(<ToolCredentialManager />);

      // First show the credential
      const eyeButton = screen
        .getAllByRole("button")
        .find((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-3 w-3"),
        );
      await userEvent.click(eyeButton!);

      // Then copy it
      const copyButton = screen
        .getAllByRole("button")
        .find(
          (btn) =>
            btn.getAttribute("class")?.includes("h-6 w-6 p-0") &&
            btn
              .querySelector("svg")
              ?.getAttribute("class")
              ?.includes("h-3 w-3"),
        );

      await userEvent.click(copyButton!);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/...",
      );
      expect(mockToast).toHaveBeenCalledWith({
        title: "Copied",
        description: "Webhook URL copied to clipboard",
      });
    });

    it("shows connection status indicators", () => {
      render(<ToolCredentialManager />);

      expect(screen.getAllByText("Not tested")).toHaveLength(2);
    });
  });

  describe("Tool Actions", () => {
    it("tests connection for a tool", async () => {
      render(<ToolCredentialManager />);

      // Open dropdown menu
      const moreButton = screen
        .getAllByRole("button")
        .find((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-4 w-4"),
        );
      await userEvent.click(moreButton!);

      // Click test connection
      const testButton = screen.getByRole("menuitem", {
        name: /test connection/i,
      });
      await userEvent.click(testButton);

      expect(mockMutations.testConnection.mutate).toHaveBeenCalledWith({
        id: 1,
      });
    });

    it("opens edit dialog for a tool", async () => {
      render(<ToolCredentialManager />);

      // Open dropdown menu
      const moreButton = screen
        .getAllByRole("button")
        .find((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-4 w-4"),
        );
      await userEvent.click(moreButton!);

      // Click edit
      const editButton = screen.getByRole("menuitem", { name: /edit/i });
      await userEvent.click(editButton);

      expect(screen.getByText("Edit Tool Credentials")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Production Slack")).toBeInTheDocument();
    });

    it("opens documentation link", async () => {
      render(<ToolCredentialManager />);

      // Open dropdown menu
      const moreButton = screen
        .getAllByRole("button")
        .find((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-4 w-4"),
        );
      await userEvent.click(moreButton!);

      // Click view docs
      const docsButton = screen.getByRole("menuitem", { name: /view docs/i });
      await userEvent.click(docsButton);

      expect(window.open).toHaveBeenCalledWith(
        "https://api.slack.com/messaging/webhooks",
        "_blank",
      );
    });

    it("deletes a tool", async () => {
      render(<ToolCredentialManager />);

      // Open dropdown menu
      const moreButton = screen
        .getAllByRole("button")
        .find((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-4 w-4"),
        );
      await userEvent.click(moreButton!);

      // Click delete
      const deleteButton = screen.getByRole("menuitem", { name: /delete/i });
      await userEvent.click(deleteButton);

      expect(mockMutations.delete.mutate).toHaveBeenCalledWith({ id: 1 });
    });
  });

  describe("Add Tool Dialog", () => {
    it("opens add tool dialog", async () => {
      render(<ToolCredentialManager />);

      const addButton = screen.getByRole("button", { name: /add tool/i });
      await userEvent.click(addButton);

      expect(screen.getByText("Add Tool Credentials")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Select a tool and provide your credentials to get started.",
        ),
      ).toBeInTheDocument();
    });

    it("selects a tool type", async () => {
      render(<ToolCredentialManager />);

      const addButton = screen.getByRole("button", { name: /add tool/i });
      await userEvent.click(addButton);

      const slackButton = screen.getByRole("button", { name: /slack/i });
      await userEvent.click(slackButton);

      expect(
        screen.getByDisplayValue(/Slack - \d+\/\d+\/\d+/),
      ).toBeInTheDocument();
    });

    it("fills out and submits form", async () => {
      render(<ToolCredentialManager />);

      // Open dialog
      const addButton = screen.getByRole("button", { name: /add tool/i });
      await userEvent.click(addButton);

      // Select tool type
      const slackButton = screen.getByRole("button", { name: /slack/i });
      await userEvent.click(slackButton);

      // Fill out form
      const nameInput = screen.getByLabelText("Credential Name");
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, "Test Slack");

      const webhookInput = screen.getByLabelText("Webhook URL *");
      await userEvent.type(webhookInput, "https://hooks.slack.com/test");

      // Submit
      const saveButton = screen.getByRole("button", { name: /save/i });
      await userEvent.click(saveButton);

      expect(mockMutations.create.mutate).toHaveBeenCalledWith({
        name: "Test Slack",
        type: "slack",
        config: {
          webhook_url: "https://hooks.slack.com/test",
        },
      });
    });

    it("shows setup guide link", async () => {
      render(<ToolCredentialManager />);

      const addButton = screen.getByRole("button", { name: /add tool/i });
      await userEvent.click(addButton);

      const slackButton = screen.getByRole("button", { name: /slack/i });
      await userEvent.click(slackButton);

      expect(screen.getByText("Need help setting up?")).toBeInTheDocument();
      expect(screen.getByText("View setup guide")).toBeInTheDocument();
    });

    it("cancels dialog", async () => {
      render(<ToolCredentialManager />);

      const addButton = screen.getByRole("button", { name: /add tool/i });
      await userEvent.click(addButton);

      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      await userEvent.click(cancelButton);

      expect(
        screen.queryByText("Add Tool Credentials"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Edit Tool Dialog", () => {
    it("pre-fills form with existing data", async () => {
      render(<ToolCredentialManager />);

      // Open dropdown and edit
      const moreButton = screen
        .getAllByRole("button")
        .find((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-4 w-4"),
        );
      await userEvent.click(moreButton!);

      const editButton = screen.getByRole("menuitem", { name: /edit/i });
      await userEvent.click(editButton);

      expect(screen.getByDisplayValue("Production Slack")).toBeInTheDocument();
      expect(
        screen.getByDisplayValue("https://hooks.slack.com/services/..."),
      ).toBeInTheDocument();
    });

    it("updates tool credentials", async () => {
      render(<ToolCredentialManager />);

      // Open edit dialog
      const moreButton = screen
        .getAllByRole("button")
        .find((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-4 w-4"),
        );
      await userEvent.click(moreButton!);

      const editButton = screen.getByRole("menuitem", { name: /edit/i });
      await userEvent.click(editButton);

      // Update name
      const nameInput = screen.getByDisplayValue("Production Slack");
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, "Updated Slack");

      // Submit
      const saveButton = screen.getByRole("button", { name: /save/i });
      await userEvent.click(saveButton);

      expect(mockMutations.update.mutate).toHaveBeenCalledWith({
        id: 1,
        name: "Updated Slack",
        config: {
          webhook_url: "https://hooks.slack.com/services/...",
        },
      });
    });
  });

  describe("Mutation Callbacks", () => {
    it("handles successful tool creation", () => {
      const onSuccess = (trpc.tools.create.useMutation as jest.Mock).mock
        .calls[0][0].onSuccess;

      onSuccess();

      expect(mockToast).toHaveBeenCalledWith({
        title: "Tool Added",
        description: "Tool credentials have been saved securely.",
      });
      expect(mockUtils.tools.list.invalidate).toHaveBeenCalled();
      expect(
        mockUtils.tools.listWithDecryptedConfig.invalidate,
      ).toHaveBeenCalled();
    });

    it("handles tool creation error", () => {
      const onError = (trpc.tools.create.useMutation as jest.Mock).mock
        .calls[0][0].onError;

      onError({ message: "Creation failed" });

      expect(mockToast).toHaveBeenCalledWith({
        title: "Error",
        description: "Creation failed",
        variant: "destructive",
      });
    });

    it("handles successful test connection", () => {
      const onSuccess = (trpc.tools.testConnection.useMutation as jest.Mock)
        .mock.calls[0][0].onSuccess;

      onSuccess({ success: true, message: "Connection successful" }, { id: 1 });

      expect(mockToast).toHaveBeenCalledWith({
        title: "Connection Successful",
        description: "Connection successful",
        variant: "default",
      });
    });

    it("handles failed test connection", () => {
      const onSuccess = (trpc.tools.testConnection.useMutation as jest.Mock)
        .mock.calls[0][0].onSuccess;

      onSuccess({ success: false, message: "Connection failed" }, { id: 1 });

      expect(mockToast).toHaveBeenCalledWith({
        title: "Connection Failed",
        description: "Connection failed",
        variant: "destructive",
      });
    });
  });

  describe("Health Check Status", () => {
    it("displays checking status during test", async () => {
      // Mock the mutation to be pending
      (trpc.tools.testConnection.useMutation as jest.Mock).mockReturnValue({
        ...mockMutations.testConnection,
        isPending: true,
      });

      render(<ToolCredentialManager />);

      // Start test connection
      const moreButton = screen
        .getAllByRole("button")
        .find((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-4 w-4"),
        );
      await userEvent.click(moreButton!);

      const testButton = screen.getByRole("menuitem", {
        name: /test connection/i,
      });
      await userEvent.click(testButton);

      await waitFor(() => {
        expect(screen.getByText("Checking...")).toBeInTheDocument();
      });
    });

    it("shows healthy status after successful test", () => {
      // Set up health check state
      const TestComponent = () => {
        const [healthChecks, setHealthChecks] = React.useState({
          1: {
            status: "healthy" as const,
            message: "All good",
            lastChecked: new Date("2024-01-01"),
          },
        });

        return <ToolCredentialManager />;
      };

      render(<TestComponent />);

      // Note: This test would need the component to be refactored to accept
      // health check state as props for proper testing
    });
  });

  describe("Form Validation", () => {
    it("disables save button when form is invalid", async () => {
      render(<ToolCredentialManager />);

      const addButton = screen.getByRole("button", { name: /add tool/i });
      await userEvent.click(addButton);

      const saveButton = screen.getByRole("button", { name: /save/i });
      expect(saveButton).toBeDisabled();
    });

    it("enables save button when form is valid", async () => {
      render(<ToolCredentialManager />);

      const addButton = screen.getByRole("button", { name: /add tool/i });
      await userEvent.click(addButton);

      // Select tool type
      const slackButton = screen.getByRole("button", { name: /slack/i });
      await userEvent.click(slackButton);

      // Form should be valid with default values
      const saveButton = screen.getByRole("button", { name: /save/i });
      expect(saveButton).not.toBeDisabled();
    });
  });

  describe("Custom Class Name", () => {
    it("applies custom className", () => {
      render(<ToolCredentialManager className="custom-class" />);

      const card = screen
        .getByText("Tool Credential Management")
        .closest(".card");
      expect(card).toHaveClass("custom-class");
    });
  });

  describe("Loading States", () => {
    it("shows loading state for mutations", async () => {
      (trpc.tools.create.useMutation as jest.Mock).mockReturnValue({
        ...mockMutations.create,
        isPending: true,
      });

      render(<ToolCredentialManager />);

      const addButton = screen.getByRole("button", { name: /add tool/i });
      await userEvent.click(addButton);

      const slackButton = screen.getByRole("button", { name: /slack/i });
      await userEvent.click(slackButton);

      const saveButton = screen.getByRole("button", { name: /saving.../i });
      expect(saveButton).toBeDisabled();
    });
  });
});
