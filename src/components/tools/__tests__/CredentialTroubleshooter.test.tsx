import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CredentialTroubleshooter from "../CredentialTroubleshooter";
import { useToast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToolPluginRegistry } from "../types/tool-plugin";
import { type Tool, type ToolType } from "@/shared/schema";

// Mock dependencies
jest.mock("@/components/ui/use-toast", () => ({
  useToast: jest.fn(),
}));

jest.mock("../types/tool-plugin", () => ({
  ToolPluginRegistry: {
    getPlugin: jest.fn(),
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

describe("CredentialTroubleshooter", () => {
  const mockToast = jest.fn();

  const sampleTool: Tool = {
    id: 1,
    name: "Production Slack",
    type: "slack" as ToolType,
    config: { webhook_url: "encrypted" },
    userId: 1,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  };

  const samplePlugin = {
    id: "slack",
    name: "Slack",
    docsUrl: "https://api.slack.com/docs",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    (ToolPluginRegistry.getPlugin as jest.Mock).mockReturnValue(samplePlugin);
  });

  describe("Rendering", () => {
    it("renders without a specific tool", () => {
      render(<CredentialTroubleshooter />);

      expect(screen.getByText("Troubleshooting Guide")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("Search troubleshooting guides..."),
      ).toBeInTheDocument();
    });

    it("renders with a specific tool", () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      expect(screen.getByText("Troubleshooting Guide")).toBeInTheDocument();
      expect(screen.getByText("Slack")).toBeInTheDocument();
    });

    it("shows error alert when error is provided", () => {
      render(<CredentialTroubleshooter error="Connection failed" />);

      expect(screen.getByText("Current Error:")).toBeInTheDocument();
      expect(screen.getByText("Connection failed")).toBeInTheDocument();
    });

    it("displays category tabs", () => {
      render(<CredentialTroubleshooter />);

      expect(
        screen.getByRole("tab", { name: /all issues/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: /authentication/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: /permissions/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /network/i })).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: /configuration/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /general/i })).toBeInTheDocument();
    });
  });

  describe("Search Functionality", () => {
    it("filters troubleshooting steps by search query", async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      const searchInput = screen.getByPlaceholderText(
        "Search troubleshooting guides...",
      );
      await userEvent.type(searchInput, "webhook");

      // Should show webhook-related issues
      expect(screen.getByText("Webhook URL Returns 404")).toBeInTheDocument();
      expect(screen.queryByText("OAuth Token Expired")).not.toBeInTheDocument();
    });

    it("searches in solution titles", async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      const searchInput = screen.getByPlaceholderText(
        "Search troubleshooting guides...",
      );
      await userEvent.type(searchInput, "regenerate");

      // Should find steps that contain "regenerate" in solutions
      expect(screen.getByText("Webhook URL Returns 404")).toBeInTheDocument();
    });

    it("shows no results message when search yields no matches", async () => {
      render(<CredentialTroubleshooter />);

      const searchInput = screen.getByPlaceholderText(
        "Search troubleshooting guides...",
      );
      await userEvent.type(searchInput, "nonexistent");

      expect(
        screen.getByText(
          "No troubleshooting guides found matching your criteria.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("Category Filtering", () => {
    it("filters by authentication category", async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      const authTab = screen.getByRole("tab", { name: /authentication/i });
      await userEvent.click(authTab);

      // Should show authentication-related issues
      expect(screen.getByText("Webhook URL Returns 404")).toBeInTheDocument();
      expect(screen.getByText("OAuth Token Expired")).toBeInTheDocument();
    });

    it("filters by network category", async () => {
      render(<CredentialTroubleshooter />);

      const networkTab = screen.getByRole("tab", { name: /network/i });
      await userEvent.click(networkTab);

      // Should show network-related issues (common ones)
      expect(screen.getByText("Connection Timeout")).toBeInTheDocument();
      expect(screen.getByText("SSL/TLS Certificate Error")).toBeInTheDocument();
    });

    it('shows all issues when "All Issues" tab is selected', async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      // First filter by category
      const authTab = screen.getByRole("tab", { name: /authentication/i });
      await userEvent.click(authTab);

      // Then go back to all
      const allTab = screen.getByRole("tab", { name: /all issues/i });
      await userEvent.click(allTab);

      // Should show both tool-specific and common issues
      expect(screen.getByText("Webhook URL Returns 404")).toBeInTheDocument();
      expect(screen.getByText("Connection Timeout")).toBeInTheDocument();
    });
  });

  describe("Tool-Specific Guides", () => {
    it("shows Slack-specific troubleshooting steps", () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      expect(screen.getByText("Webhook URL Returns 404")).toBeInTheDocument();
      expect(screen.getByText("OAuth Token Expired")).toBeInTheDocument();
      expect(screen.getByText("Rate Limit Exceeded")).toBeInTheDocument();
    });

    it("shows Discord-specific troubleshooting steps", () => {
      const discordTool = { ...sampleTool, type: "discord" as ToolType };
      render(<CredentialTroubleshooter tool={discordTool} />);

      expect(screen.getByText("Invalid Webhook URL")).toBeInTheDocument();
    });

    it("shows email-specific troubleshooting steps", () => {
      const emailTool = { ...sampleTool, type: "email" as ToolType };
      render(<CredentialTroubleshooter tool={emailTool} />);

      expect(screen.getByText("SMTP Connection Failed")).toBeInTheDocument();
      expect(screen.getByText("Authentication Failed")).toBeInTheDocument();
    });
  });

  describe("Error Prioritization", () => {
    it("prioritizes relevant steps based on error message", () => {
      render(
        <CredentialTroubleshooter tool={sampleTool} error="webhook 404" />,
      );

      // Should prioritize webhook-related issues
      const accordionItems = screen
        .getAllByRole("button")
        .filter((btn) => btn.getAttribute("data-state") !== undefined);

      // First item should be the most relevant
      expect(accordionItems[0]).toHaveTextContent("Webhook URL Returns 404");
    });

    it("handles case-insensitive error matching", () => {
      render(
        <CredentialTroubleshooter tool={sampleTool} error="OAUTH TOKEN" />,
      );

      const accordionItems = screen
        .getAllByRole("button")
        .filter((btn) => btn.getAttribute("data-state") !== undefined);

      // Should prioritize OAuth token issues
      expect(accordionItems[0]).toHaveTextContent("OAuth Token Expired");
    });
  });

  describe("Accordion Interactions", () => {
    it("expands troubleshooting step when clicked", async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      const webhookIssue = screen.getByText("Webhook URL Returns 404");
      await userEvent.click(webhookIssue);

      // Should show solutions
      await waitFor(() => {
        expect(screen.getByText("Regenerate Webhook URL")).toBeInTheDocument();
        expect(
          screen.getByText("Go to your Slack workspace settings"),
        ).toBeInTheDocument();
      });
    });

    it("shows numbered steps in solutions", async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      const webhookIssue = screen.getByText("Webhook URL Returns 404");
      await userEvent.click(webhookIssue);

      await waitFor(() => {
        // Should show numbered step indicators
        expect(screen.getByText("1")).toBeInTheDocument();
        expect(screen.getByText("2")).toBeInTheDocument();
        expect(screen.getByText("3")).toBeInTheDocument();
      });
    });

    it("displays code examples when available", async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      const oauthIssue = screen.getByText("OAuth Token Expired");
      await userEvent.click(oauthIssue);

      await waitFor(() => {
        expect(screen.getByText("Example Code")).toBeInTheDocument();
        expect(screen.getByText("xoxb-your-token-here")).toBeInTheDocument();
      });
    });

    it("shows external documentation links", async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      const webhookIssue = screen.getByText("Webhook URL Returns 404");
      await userEvent.click(webhookIssue);

      await waitFor(() => {
        const docsButton = screen.getByRole("button", {
          name: /slack webhooks documentation/i,
        });
        expect(docsButton).toBeInTheDocument();

        await userEvent.click(docsButton);
        expect(window.open).toHaveBeenCalledWith(
          "https://api.slack.com/messaging/webhooks",
          "_blank",
        );
      });
    });
  });

  describe("Code Copying", () => {
    it("copies code to clipboard when copy button is clicked", async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      const oauthIssue = screen.getByText("OAuth Token Expired");
      await userEvent.click(oauthIssue);

      await waitFor(async () => {
        const copyButton = screen
          .getByRole("button")
          .querySelector('svg[class*="h-3 w-3"]')?.parentElement;
        await userEvent.click(copyButton!);

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          "xoxb-your-token-here",
        );
        expect(mockToast).toHaveBeenCalledWith({
          title: "Copied",
          description: "Code copied to clipboard",
        });
      });
    });

    it("handles clipboard copy errors", async () => {
      // Mock clipboard failure
      navigator.clipboard.writeText = jest
        .fn()
        .mockRejectedValue(new Error("Clipboard error"));

      render(<CredentialTroubleshooter tool={sampleTool} />);

      const oauthIssue = screen.getByText("OAuth Token Expired");
      await userEvent.click(oauthIssue);

      await waitFor(async () => {
        const copyButton = screen
          .getByRole("button")
          .querySelector('svg[class*="h-3 w-3"]')?.parentElement;
        await userEvent.click(copyButton!);

        expect(mockToast).toHaveBeenCalledWith({
          title: "Error",
          description: "Failed to copy code",
          variant: "destructive",
        });
      });
    });
  });

  describe("Additional Resources", () => {
    it("renders additional resources section", () => {
      render(<CredentialTroubleshooter />);

      expect(screen.getByText("Additional Resources")).toBeInTheDocument();
      expect(
        screen.getByText("Tool Integration Documentation"),
      ).toBeInTheDocument();
      expect(screen.getByText("Contact Support")).toBeInTheDocument();
    });

    it("opens tool documentation when available", async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      const docsButton = screen.getByRole("button", {
        name: /official slack docs/i,
      });
      await userEvent.click(docsButton);

      expect(window.open).toHaveBeenCalledWith(
        "https://api.slack.com/docs",
        "_blank",
      );
    });

    it("opens general documentation", async () => {
      render(<CredentialTroubleshooter />);

      const docsButton = screen.getByRole("button", {
        name: /tool integration documentation/i,
      });
      await userEvent.click(docsButton);

      expect(window.open).toHaveBeenCalledWith("/docs/tools", "_blank");
    });

    it("opens support page", async () => {
      render(<CredentialTroubleshooter />);

      const supportButton = screen.getByRole("button", {
        name: /contact support/i,
      });
      await userEvent.click(supportButton);

      expect(window.open).toHaveBeenCalledWith("/support", "_blank");
    });

    it("does not show tool-specific docs when tool has no docsUrl", () => {
      (ToolPluginRegistry.getPlugin as jest.Mock).mockReturnValue({
        id: "slack",
        name: "Slack",
        // No docsUrl
      });

      render(<CredentialTroubleshooter tool={sampleTool} />);

      expect(
        screen.queryByText(/official slack docs/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("Common Troubleshooting Steps", () => {
    it("always includes common troubleshooting steps", () => {
      render(<CredentialTroubleshooter />);

      expect(screen.getByText("Connection Timeout")).toBeInTheDocument();
      expect(screen.getByText("SSL/TLS Certificate Error")).toBeInTheDocument();
    });

    it("shows common steps even with tool-specific ones", () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      // Should show both Slack-specific and common issues
      expect(screen.getByText("Webhook URL Returns 404")).toBeInTheDocument(); // Slack-specific
      expect(screen.getByText("Connection Timeout")).toBeInTheDocument(); // Common
    });
  });

  describe("Multiple Tool Types", () => {
    it("handles tools without specific troubleshooting guides", () => {
      const unknownTool = { ...sampleTool, type: "unknown" as ToolType };
      render(<CredentialTroubleshooter tool={unknownTool} />);

      // Should still show common troubleshooting steps
      expect(screen.getByText("Connection Timeout")).toBeInTheDocument();
      expect(screen.getByText("SSL/TLS Certificate Error")).toBeInTheDocument();
    });

    it("shows correct steps for different tool types", () => {
      const { rerender } = render(
        <CredentialTroubleshooter tool={sampleTool} />,
      );
      expect(screen.getByText("Webhook URL Returns 404")).toBeInTheDocument();

      // Change to Discord tool
      const discordTool = { ...sampleTool, type: "discord" as ToolType };
      rerender(<CredentialTroubleshooter tool={discordTool} />);
      expect(screen.getByText("Invalid Webhook URL")).toBeInTheDocument();
    });
  });

  describe("Props", () => {
    it("applies custom className", () => {
      render(<CredentialTroubleshooter className="custom-class" />);

      const card = screen.getByText("Troubleshooting Guide").closest(".card");
      expect(card).toHaveClass("custom-class");
    });

    it("handles missing tool prop gracefully", () => {
      render(<CredentialTroubleshooter />);

      expect(screen.getByText("Troubleshooting Guide")).toBeInTheDocument();
      expect(screen.queryByText("Slack")).not.toBeInTheDocument();
    });

    it("handles missing error prop gracefully", () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      expect(screen.queryByText("Current Error:")).not.toBeInTheDocument();
    });
  });

  describe("Responsive Design", () => {
    it("shows responsive category tabs", () => {
      render(<CredentialTroubleshooter />);

      // Category tabs should be responsive
      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(6); // All categories
    });
  });

  describe("Complex Filtering Combinations", () => {
    it("applies both search and category filters", async () => {
      render(<CredentialTroubleshooter tool={sampleTool} />);

      // First apply category filter
      const authTab = screen.getByRole("tab", { name: /authentication/i });
      await userEvent.click(authTab);

      // Then apply search
      const searchInput = screen.getByPlaceholderText(
        "Search troubleshooting guides...",
      );
      await userEvent.type(searchInput, "webhook");

      // Should show only webhook + authentication issues
      expect(screen.getByText("Webhook URL Returns 404")).toBeInTheDocument();
      expect(screen.queryByText("Connection Timeout")).not.toBeInTheDocument();
    });
  });
});
