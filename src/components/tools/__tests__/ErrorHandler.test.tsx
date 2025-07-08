import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorHandler, { type ErrorInfo } from "../ErrorHandler";
import { useToast } from "@/components/ui/use-toast";

// Mock the toast hook
jest.mock("@/components/ui/use-toast", () => ({
  useToast: jest.fn(),
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
});

describe("ErrorHandler", () => {
  const mockToast = jest.fn();
  const mockOnRetry = jest.fn().mockResolvedValue(undefined);
  const mockOnDismiss = jest.fn();
  const mockOnReport = jest.fn();

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

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("Rendering", () => {
    it("renders error information correctly", () => {
      render(<ErrorHandler error={baseError} />);

      expect(screen.getByText("An Error Occurred")).toBeInTheDocument();
      expect(screen.getByText("This is a test error")).toBeInTheDocument();
      expect(screen.getByText("medium")).toBeInTheDocument();
      expect(screen.getByText("system")).toBeInTheDocument();
    });

    it("renders transformed error for known error codes", () => {
      const error: ErrorInfo = {
        ...baseError,
        code: "ECONNREFUSED",
      };

      render(<ErrorHandler error={error} />);

      expect(screen.getByText("Connection Refused")).toBeInTheDocument();
      expect(
        screen.getByText(/Unable to connect to the service/),
      ).toBeInTheDocument();
    });

    it("renders compact mode correctly", () => {
      render(<ErrorHandler error={baseError} compact />);

      expect(screen.queryByText("Technical Details")).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("renders context information when available", () => {
      const errorWithContext: ErrorInfo = {
        ...baseError,
        context: {
          toolName: "Slack",
          actionName: "send-message",
          eventId: 123,
        },
      };

      render(<ErrorHandler error={errorWithContext} />);

      expect(screen.getByText("Context")).toBeInTheDocument();
      expect(screen.getByText("Slack")).toBeInTheDocument();
      expect(screen.getByText("send-message")).toBeInTheDocument();
      expect(screen.getByText("#123")).toBeInTheDocument();
    });

    it("renders retry information when available", () => {
      const errorWithRetry: ErrorInfo = {
        ...baseError,
        retry: {
          attempted: 2,
          maxAttempts: 5,
          canRetry: true,
        },
      };

      render(<ErrorHandler error={errorWithRetry} onRetry={mockOnRetry} />);

      expect(screen.getByText("Retry Status")).toBeInTheDocument();
      expect(screen.getByText("2 / 5 attempts")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /retry now/i }),
      ).toBeInTheDocument();
    });

    it("renders suggestions when available", () => {
      const errorWithSuggestions: ErrorInfo = {
        ...baseError,
        suggestions: ["Check your internet connection", "Try again later"],
      };

      render(<ErrorHandler error={errorWithSuggestions} />);

      expect(screen.getByText("Suggestions")).toBeInTheDocument();
      expect(
        screen.getByText("Check your internet connection"),
      ).toBeInTheDocument();
      expect(screen.getByText("Try again later")).toBeInTheDocument();
    });

    it("renders documentation links when available", () => {
      const errorWithDocs: ErrorInfo = {
        ...baseError,
        documentation: [
          { title: "API Guide", url: "https://docs.example.com/api" },
          {
            title: "Troubleshooting",
            url: "https://docs.example.com/troubleshoot",
          },
        ],
      };

      render(<ErrorHandler error={errorWithDocs} />);

      expect(screen.getByText("Related Documentation")).toBeInTheDocument();
      expect(screen.getByText("API Guide")).toBeInTheDocument();
      expect(screen.getByText("Troubleshooting")).toBeInTheDocument();
    });
  });

  describe("Severity Styling", () => {
    it.each([
      ["low", "text-blue-600"],
      ["medium", "text-yellow-600"],
      ["high", "text-orange-600"],
      ["critical", "text-red-600"],
    ])("applies correct styling for %s severity", (severity, expectedClass) => {
      const error: ErrorInfo = {
        ...baseError,
        severity: severity as ErrorInfo["severity"],
      };

      render(<ErrorHandler error={error} />);

      const severityBadge = screen.getByText(severity);
      expect(severityBadge.className).toContain(expectedClass);
    });
  });

  describe("Category Icons", () => {
    it.each([
      ["network", "Zap"],
      ["auth", "Shield"],
      ["validation", "AlertCircle"],
      ["system", "Terminal"],
      ["tool", "Activity"],
    ])("shows correct icon for %s category", (category) => {
      const error: ErrorInfo = {
        ...baseError,
        category: category as ErrorInfo["category"],
      };

      render(<ErrorHandler error={error} />);

      // Check that the category is rendered
      const categoryBadge = screen.getByText(category);
      expect(categoryBadge).toBeInTheDocument();
      // Check that the badge has the correct variant class
      expect(categoryBadge.className).toContain("outline");
    });
  });

  describe("Interactions", () => {
    it("handles retry action", async () => {
      const errorWithRetry: ErrorInfo = {
        ...baseError,
        retry: {
          attempted: 1,
          maxAttempts: 3,
          canRetry: true,
        },
      };

      render(<ErrorHandler error={errorWithRetry} onRetry={mockOnRetry} />);

      const retryButton = screen.getByRole("button", { name: /retry now/i });
      await userEvent.click(retryButton);

      await waitFor(() => {
        expect(mockOnRetry).toHaveBeenCalledTimes(1);
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: "Retry Successful",
          description: "The operation completed successfully.",
        });
      });
    });

    it("handles failed retry", async () => {
      mockOnRetry.mockRejectedValueOnce(new Error("Retry failed"));

      const errorWithRetry: ErrorInfo = {
        ...baseError,
        retry: {
          attempted: 1,
          maxAttempts: 3,
          canRetry: true,
        },
      };

      render(<ErrorHandler error={errorWithRetry} onRetry={mockOnRetry} />);

      await userEvent.click(screen.getByRole("button", { name: /retry now/i }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: "Retry Failed",
          description: "The operation failed again. Please try later.",
          variant: "destructive",
        });
      });
    });

    it("handles dismiss action", async () => {
      render(<ErrorHandler error={baseError} onDismiss={mockOnDismiss} />);

      const dismissButton = screen.getByRole("button", { name: /dismiss/i });
      await userEvent.click(dismissButton);

      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    });

    it("handles copy error details", async () => {
      render(<ErrorHandler error={baseError} />);

      const copyButton = screen.getByRole("button", {
        name: /copy error details/i,
      });
      await userEvent.click(copyButton);

      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith({
        title: "Copied",
        description: "Error details copied to clipboard",
      });
    });

    it("handles download error log", async () => {
      // Mock URL.createObjectURL and URL.revokeObjectURL
      const mockCreateObjectURL = jest.fn(() => "blob:url");
      const mockRevokeObjectURL = jest.fn();
      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;

      // Mock document.createElement and click
      const mockClick = jest.fn();
      const mockElement = document.createElement("a");
      mockElement.click = mockClick;
      jest.spyOn(document, "createElement").mockReturnValue(mockElement);
      jest
        .spyOn(document.body, "appendChild")
        .mockImplementation(() => mockElement);
      jest
        .spyOn(document.body, "removeChild")
        .mockImplementation(() => mockElement);

      render(<ErrorHandler error={baseError} />);

      const downloadButton = screen.getByRole("button", {
        name: /download error log/i,
      });
      await userEvent.click(downloadButton);

      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(mockElement.download).toContain("error-TEST_ERROR");
      expect(mockClick).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });

    it("toggles technical details", async () => {
      render(<ErrorHandler error={baseError} showDetails />);

      const detailsButton = screen.getByText("Technical Details");

      // Initially collapsed - tabs should not be visible
      expect(
        screen.queryByRole("tab", { name: /details/i }),
      ).not.toBeInTheDocument();

      // Click to expand
      await userEvent.click(detailsButton);

      // Now tabs should be visible
      expect(screen.getByRole("tab", { name: /details/i })).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: /stack trace/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: /raw error/i }),
      ).toBeInTheDocument();
    });

    it("handles report issue dialog", async () => {
      render(<ErrorHandler error={baseError} onReport={mockOnReport} />);

      const reportButton = screen.getByRole("button", {
        name: /report issue/i,
      });
      await userEvent.click(reportButton);

      // Dialog should open
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByText(/help us improve by reporting this error/i),
      ).toBeInTheDocument();

      // Submit report
      const sendButton = screen.getByRole("button", { name: /send report/i });
      await userEvent.click(sendButton);

      expect(mockOnReport).toHaveBeenCalledWith(baseError);
      expect(mockToast).toHaveBeenCalledWith({
        title: "Issue Reported",
        description: "Thank you for helping us improve.",
      });
    });
  });

  describe("Retry Countdown", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("shows countdown when nextRetryAt is set", async () => {
      const futureTime = new Date(Date.now() + 5000);
      const errorWithCountdown: ErrorInfo = {
        ...baseError,
        retry: {
          attempted: 1,
          maxAttempts: 3,
          canRetry: true,
          nextRetryAt: futureTime,
        },
      };

      render(<ErrorHandler error={errorWithCountdown} onRetry={mockOnRetry} />);

      expect(screen.getByText(/retry in 5s/i)).toBeInTheDocument();

      // Advance timer
      jest.advanceTimersByTime(2000);

      await waitFor(() => {
        expect(screen.getByText(/retry in 3s/i)).toBeInTheDocument();
      });
    });

    it("enables retry button when countdown reaches zero", async () => {
      const futureTime = new Date(Date.now() + 1000);
      const errorWithCountdown: ErrorInfo = {
        ...baseError,
        retry: {
          attempted: 1,
          maxAttempts: 3,
          canRetry: true,
          nextRetryAt: futureTime,
        },
      };

      render(<ErrorHandler error={errorWithCountdown} onRetry={mockOnRetry} />);

      const retryButton = screen.getByText(/retry in 1s/i).closest("button");
      expect(retryButton).toBeDisabled();

      // Advance timer past countdown
      jest.advanceTimersByTime(2000);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /retry now/i }),
        ).not.toBeDisabled();
      });
    });
  });

  describe("Error Transformations", () => {
    const testCases = [
      { code: "ECONNREFUSED", title: "Connection Refused" },
      { code: "ETIMEDOUT", title: "Request Timeout" },
      { code: "ENOTFOUND", title: "Service Not Found" },
      { code: "401", title: "Authentication Failed" },
      { code: "403", title: "Access Denied" },
      { code: "404", title: "Resource Not Found" },
      { code: "429", title: "Rate Limit Exceeded" },
      { code: "500", title: "Server Error" },
    ];

    it.each(testCases)(
      "transforms $code error correctly",
      ({ code, title }) => {
        const error: ErrorInfo = {
          ...baseError,
          code,
        };

        render(<ErrorHandler error={error} />);

        expect(screen.getByText(title)).toBeInTheDocument();
      },
    );
  });
});
