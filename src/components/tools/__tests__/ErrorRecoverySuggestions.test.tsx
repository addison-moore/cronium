import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorRecoverySuggestions, {
  type RecoverySuggestion,
} from "../ErrorRecoverySuggestions";
import { type ErrorInfo } from "../ErrorHandler";
import { useToast } from "@/components/ui/use-toast";

// Mock dependencies
jest.mock("@/components/ui/use-toast", () => ({
  useToast: jest.fn(),
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
});

// Mock window.open
global.window.open = jest.fn();

describe("ErrorRecoverySuggestions", () => {
  const mockToast = jest.fn();
  const mockOnApplySuggestion = jest.fn();

  const baseError: ErrorInfo = {
    code: "TEST_ERROR",
    message: "This is a test error",
    timestamp: new Date("2024-01-01T12:00:00Z"),
    severity: "medium",
    category: "system",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
  });

  describe("Rendering", () => {
    it("renders with no suggestions for unknown error", () => {
      render(<ErrorRecoverySuggestions error={baseError} />);

      expect(screen.getByText("Recovery Suggestions")).toBeInTheDocument();
      expect(
        screen.getByText(/No specific suggestions available/),
      ).toBeInTheDocument();
    });

    it("renders pattern-based suggestions for ECONNREFUSED", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ECONNREFUSED",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      expect(screen.getByText("Check Service Status")).toBeInTheDocument();
      expect(
        screen.getByText("Retry with Exponential Backoff"),
      ).toBeInTheDocument();
      expect(screen.getByText("Use Fallback Endpoint")).toBeInTheDocument();
    });

    it("renders custom suggestions from error", () => {
      const error: ErrorInfo = {
        ...baseError,
        suggestions: [
          "Check your network connection",
          "Verify the API endpoint is correct",
        ],
      };

      render(<ErrorRecoverySuggestions error={error} />);

      expect(
        screen.getByText("Check your network connection"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Verify the API endpoint is correct"),
      ).toBeInTheDocument();
    });

    it("shows correct number of suggestions in badge", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "401",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      // Should have 2 suggestions for 401 + generic suggestions
      const badge = screen.getByText(/\d+ options/);
      expect(badge).toBeInTheDocument();
    });
  });

  describe("Suggestion Categories", () => {
    it("displays correct icons for each category", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ECONNREFUSED",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      // Check Service Status is investigation category
      const investigationSuggestion = screen.getByText("Check Service Status");
      expect(investigationSuggestion.closest(".flex")).toBeInTheDocument();

      // Retry is retry category
      const retrySuggestion = screen.getByText(
        "Retry with Exponential Backoff",
      );
      expect(retrySuggestion.closest(".flex")).toBeInTheDocument();
    });

    it("displays confidence levels correctly", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ECONNREFUSED",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      expect(screen.getByText("high confidence")).toBeInTheDocument();
      expect(screen.getByText("medium confidence")).toBeInTheDocument();
    });

    it("shows automated badge for automated suggestions", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "429",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      const automatedBadges = screen.getAllByText("Automated");
      expect(automatedBadges.length).toBeGreaterThan(0);
    });

    it("displays estimated time when available", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ECONNREFUSED",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      expect(screen.getByText("5-10 minutes")).toBeInTheDocument();
      expect(screen.getByText("1-2 minutes")).toBeInTheDocument();
    });

    it("shows success rate when available", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ECONNREFUSED",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      expect(screen.getByText("85% success rate")).toBeInTheDocument();
      expect(screen.getByText("70% success rate")).toBeInTheDocument();
    });
  });

  describe("Accordion Interactions", () => {
    it("expands suggestion details when clicked", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "401",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      const trigger = screen.getByText("Refresh Authentication Credentials");
      await userEvent.click(trigger);

      // Should show steps
      await waitFor(() => {
        expect(screen.getByText("Steps to Apply:")).toBeInTheDocument();
        expect(
          screen.getByText("Navigate to credential manager"),
        ).toBeInTheDocument();
      });
    });

    it("shows prerequisites when available", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "401",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      // Expand token expiry suggestion
      const trigger = screen.getByText("Check Token Expiration");
      await userEvent.click(trigger);

      await waitFor(() => {
        expect(screen.getByText("Prerequisites:")).toBeInTheDocument();
        expect(
          screen.getByText("Valid refresh token available"),
        ).toBeInTheDocument();
      });
    });

    it("displays risks when available", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ECONNREFUSED",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      const trigger = screen.getByText("Use Fallback Endpoint");
      await userEvent.click(trigger);

      await waitFor(() => {
        expect(screen.getByText("Potential Risks:")).toBeInTheDocument();
        expect(
          screen.getByText(/different performance characteristics/),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Code Snippets", () => {
    it("displays code snippets for code steps", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ECONNREFUSED",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      const trigger = screen.getByText("Check Service Status");
      await userEvent.click(trigger);

      await waitFor(() => {
        expect(
          screen.getByText("curl -I https://api.example.com/health"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("nslookup api.example.com"),
        ).toBeInTheDocument();
      });
    });

    it("copies code snippet when copy button clicked", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ECONNREFUSED",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      // Expand suggestion
      const trigger = screen.getByText("Check Service Status");
      await userEvent.click(trigger);

      // Find and click copy button
      const copyButtons = screen
        .getAllByRole("button")
        .filter((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-3 w-3"),
        );
      await userEvent.click(copyButtons[0]);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "curl -I https://api.example.com/health",
      );
      expect(mockToast).toHaveBeenCalledWith({
        title: "Copied",
        description: "Code snippet copied to clipboard",
      });
    });
  });

  describe("Configuration Display", () => {
    it("shows configuration for config steps", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "429",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      const trigger = screen.getByText("Implement Client-Side Rate Limiting");
      await userEvent.click(trigger);

      await waitFor(() => {
        expect(screen.getByText("Configuration:")).toBeInTheDocument();
        expect(screen.getByText(/"requestsPerMinute": 60/)).toBeInTheDocument();
        expect(screen.getByText(/"requestsPerHour": 1000/)).toBeInTheDocument();
      });
    });

    it("displays validation criteria when available", async () => {
      // Create a custom error pattern with validation
      const error: ErrorInfo = {
        ...baseError,
        code: "CUSTOM_ERROR",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      // For custom errors, it should show generic suggestions
      const trigger = screen.getByText("Review Detailed Logs");
      await userEvent.click(trigger);

      await waitFor(() => {
        expect(screen.getByText("Steps to Apply:")).toBeInTheDocument();
      });
    });
  });

  describe("Apply Functionality", () => {
    it("applies automated suggestion when button clicked", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "429",
      };

      render(
        <ErrorRecoverySuggestions
          error={error}
          onApplySuggestion={mockOnApplySuggestion}
          showAutoFix={true}
        />,
      );

      // Expand automated suggestion
      const trigger = screen.getByText("Implement Client-Side Rate Limiting");
      await userEvent.click(trigger);

      // Click apply button
      const applyButton = screen.getByRole("button", {
        name: /apply automatically/i,
      });
      await userEvent.click(applyButton);

      // Should show loading state
      expect(screen.getByText("Applying...")).toBeInTheDocument();

      // Wait for completion
      await waitFor(() => {
        expect(screen.getByText("Applied")).toBeInTheDocument();
        expect(mockOnApplySuggestion).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "implement-rate-limiting",
            title: "Implement Client-Side Rate Limiting",
          }),
        );
        expect(mockToast).toHaveBeenCalledWith({
          title: "Suggestion Applied",
          description:
            "Implement Client-Side Rate Limiting has been applied successfully",
        });
      });
    });

    it("shows error when auto-fix is disabled", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "429",
      };

      render(
        <ErrorRecoverySuggestions
          error={error}
          onApplySuggestion={mockOnApplySuggestion}
          showAutoFix={false}
        />,
      );

      // Expand automated suggestion
      const trigger = screen.getByText("Implement Client-Side Rate Limiting");
      await userEvent.click(trigger);

      // Apply button should not be visible
      expect(
        screen.queryByRole("button", { name: /apply automatically/i }),
      ).not.toBeInTheDocument();
    });

    it("disables apply button after successful application", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "429",
      };

      render(
        <ErrorRecoverySuggestions
          error={error}
          onApplySuggestion={mockOnApplySuggestion}
          showAutoFix={true}
        />,
      );

      const trigger = screen.getByText("Implement Client-Side Rate Limiting");
      await userEvent.click(trigger);

      const applyButton = screen.getByRole("button", {
        name: /apply automatically/i,
      });
      await userEvent.click(applyButton);

      await waitFor(() => {
        expect(applyButton).toBeDisabled();
        expect(applyButton).toHaveTextContent("Applied");
      });
    });

    it("shows checkmark for applied suggestions", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "429",
      };

      render(
        <ErrorRecoverySuggestions
          error={error}
          onApplySuggestion={mockOnApplySuggestion}
          showAutoFix={true}
        />,
      );

      // Apply a suggestion
      const trigger = screen.getByText("Implement Client-Side Rate Limiting");
      await userEvent.click(trigger);

      const applyButton = screen.getByRole("button", {
        name: /apply automatically/i,
      });
      await userEvent.click(applyButton);

      await waitFor(() => {
        // Should show checkmark icon next to title
        const titleElement = screen.getByText(
          "Implement Client-Side Rate Limiting",
        );
        const checkIcon =
          titleElement.parentElement?.querySelector("svg.text-green-600");
        expect(checkIcon).toBeInTheDocument();
      });
    });
  });

  describe("Help Section", () => {
    it("renders additional help section", () => {
      render(<ErrorRecoverySuggestions error={baseError} />);

      expect(screen.getByText("Need More Help?")).toBeInTheDocument();
      expect(
        screen.getByText("View Troubleshooting Guide"),
      ).toBeInTheDocument();
      expect(screen.getByText("Contact Support Team")).toBeInTheDocument();
    });

    it("opens troubleshooting guide in new window", async () => {
      render(<ErrorRecoverySuggestions error={baseError} />);

      const guideButton = screen.getByRole("button", {
        name: /view troubleshooting guide/i,
      });
      await userEvent.click(guideButton);

      expect(window.open).toHaveBeenCalledWith(
        "/docs/troubleshooting",
        "_blank",
      );
    });

    it("opens support page in new window", async () => {
      render(<ErrorRecoverySuggestions error={baseError} />);

      const supportButton = screen.getByRole("button", {
        name: /contact support team/i,
      });
      await userEvent.click(supportButton);

      expect(window.open).toHaveBeenCalledWith("/support", "_blank");
    });
  });

  describe("Error Pattern Matching", () => {
    it("matches error code directly", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ETIMEDOUT",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      expect(screen.getByText("Increase Timeout Settings")).toBeInTheDocument();
      expect(screen.getByText("Optimize Request Size")).toBeInTheDocument();
    });

    it("matches error code in message", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "UNKNOWN",
        message: "Connection failed with ETIMEDOUT",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      expect(screen.getByText("Increase Timeout Settings")).toBeInTheDocument();
    });

    it("matches status code from details", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "HTTP_ERROR",
        details: {
          statusCode: 429,
        },
      };

      render(<ErrorRecoverySuggestions error={error} />);

      expect(
        screen.getByText("Implement Client-Side Rate Limiting"),
      ).toBeInTheDocument();
      expect(screen.getByText("Batch Multiple Requests")).toBeInTheDocument();
    });
  });

  describe("Sorting", () => {
    it("sorts suggestions by confidence level", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "401",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      // Get all suggestion titles in order
      const suggestionTitles = screen
        .getAllByRole("button")
        .filter((btn) => btn.getAttribute("data-state") !== undefined)
        .map((btn) => btn.textContent);

      // High confidence suggestions should appear first
      expect(suggestionTitles[0]).toContain(
        "Refresh Authentication Credentials",
      );
      expect(suggestionTitles[1]).toContain("Check Token Expiration");
    });
  });

  describe("Props", () => {
    it("respects className prop", () => {
      render(
        <ErrorRecoverySuggestions error={baseError} className="custom-class" />,
      );

      const card = screen.getByText("Recovery Suggestions").closest(".card");
      expect(card).toHaveClass("custom-class");
    });
  });

  describe("Complex Error Scenarios", () => {
    it("handles batched request suggestion for 429 errors", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "429",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      const trigger = screen.getByText("Batch Multiple Requests");
      await userEvent.click(trigger);

      await waitFor(() => {
        expect(
          screen.getByText(/Instead of multiple calls/),
        ).toBeInTheDocument();
        expect(screen.getByText(/Use batch API/)).toBeInTheDocument();
      });
    });

    it("shows pagination suggestion for timeout errors", async () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ETIMEDOUT",
      };

      render(<ErrorRecoverySuggestions error={error} />);

      const trigger = screen.getByText("Optimize Request Size");
      await userEvent.click(trigger);

      await waitFor(() => {
        expect(
          screen.getByText(/Process in smaller batches/),
        ).toBeInTheDocument();
        expect(screen.getByText(/const batchSize = 100/)).toBeInTheDocument();
      });
    });
  });
});
