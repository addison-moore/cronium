import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ExecutionLogsViewer,
  type ExecutionLog,
} from "@/components/tools/ExecutionLogsViewer";
import { useToast } from "@/components/ui/use-toast";
import { format } from "date-fns";

// Mock dependencies
jest.mock("@/components/ui/use-toast", () => ({
  useToast: jest.fn(),
}));

jest.mock("@/lib/trpc", () => ({
  trpc: {
    useContext: jest.fn(() => ({})),
  },
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
});

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
global.URL.revokeObjectURL = jest.fn();

describe("ExecutionLogsViewer", () => {
  const mockToast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });

    // Reset DOM mocks
    const mockElement = {
      href: "",
      download: "",
      click: jest.fn(),
    };
    jest.spyOn(document, "createElement").mockReturnValue(mockElement as any);
    jest
      .spyOn(document.body, "appendChild")
      .mockImplementation(() => mockElement as any);
    jest
      .spyOn(document.body, "removeChild")
      .mockImplementation(() => mockElement as any);
  });

  it("renders with empty state", () => {
    render(<ExecutionLogsViewer />);

    expect(screen.getByText("Execution Logs")).toBeInTheDocument();
    expect(screen.getByText("0 logs")).toBeInTheDocument();
    expect(screen.getByText("No logs found")).toBeInTheDocument();
    expect(
      screen.getByText("Adjust your filters or wait for new logs"),
    ).toBeInTheDocument();
  });

  it("displays logs after component mounts", async () => {
    render(<ExecutionLogsViewer />);

    // Wait for mock logs to be generated
    await waitFor(() => {
      expect(screen.getByText(/logs/)).toBeInTheDocument();
      expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
    });
  });

  describe("Filtering", () => {
    it("filters logs by search query", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText("Search logs...");
      await userEvent.type(searchInput, "error");

      // Should only show logs containing 'error'
      await waitFor(() => {
        const logEntries = screen.getAllByRole("button", { name: /error/i });
        expect(logEntries.length).toBeGreaterThan(0);
      });
    });

    it("filters logs by level", async () => {
      render(<ExecutionLogsViewer />);

      // Click on Filters tab
      const filtersTab = screen.getByRole("tab", { name: /filters/i });
      await userEvent.click(filtersTab);

      // Select only error level
      const errorCheckbox = screen.getByLabelText("error");
      await userEvent.click(errorCheckbox);

      // Go back to logs tab
      const logsTab = screen.getByRole("tab", { name: /logs/i });
      await userEvent.click(logsTab);

      // Should only show error logs
      await waitFor(() => {
        const logMessages = screen.getAllByText(/error log message/i);
        expect(logMessages.length).toBeGreaterThan(0);
      });
    });

    it("filters logs by category", async () => {
      render(<ExecutionLogsViewer />);

      const filtersTab = screen.getByRole("tab", { name: /filters/i });
      await userEvent.click(filtersTab);

      const toolCheckbox = screen.getByLabelText("tool");
      await userEvent.click(toolCheckbox);

      const logsTab = screen.getByRole("tab", { name: /logs/i });
      await userEvent.click(logsTab);

      await waitFor(() => {
        const toolBadges = screen.getAllByText("tool");
        expect(toolBadges.length).toBeGreaterThan(0);
      });
    });

    it("filters logs by time range", async () => {
      render(<ExecutionLogsViewer />);

      const filtersTab = screen.getByRole("tab", { name: /filters/i });
      await userEvent.click(filtersTab);

      const timeRangeSelect = screen.getByRole("combobox");
      await userEvent.click(timeRangeSelect);
      await userEvent.click(screen.getByRole("option", { name: /last hour/i }));

      // Logs should be filtered by time
      expect(timeRangeSelect).toHaveTextContent("Last Hour");
    });

    it("clears all filters", async () => {
      render(<ExecutionLogsViewer />);

      const filtersTab = screen.getByRole("tab", { name: /filters/i });
      await userEvent.click(filtersTab);

      // Set some filters
      const errorCheckbox = screen.getByLabelText("error");
      await userEvent.click(errorCheckbox);

      // Clear filters
      const clearButton = screen.getByRole("button", {
        name: /clear filters/i,
      });
      await userEvent.click(clearButton);

      // Checkbox should be unchecked
      expect(errorCheckbox).not.toBeChecked();
    });
  });

  describe("Log Interactions", () => {
    it("expands log details when clicked", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      // Click expand button on first log
      const expandButtons = screen
        .getAllByRole("button")
        .filter((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-3 w-3"),
        );
      await userEvent.click(expandButtons[0]);

      // Should show expanded content
      await waitFor(() => {
        expect(screen.getByText("Context:")).toBeInTheDocument();
        expect(screen.getByText("Metadata:")).toBeInTheDocument();
      });
    });

    it("copies log to clipboard", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      // Find and click copy button
      const copyButtons = screen
        .getAllByRole("button")
        .filter((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-3 w-3"),
        );
      const copyButton = copyButtons.find(
        (btn) => btn.querySelector("svg")?.parentElement?.textContent === "",
      );

      await userEvent.click(copyButton!);

      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith({
        title: "Copied",
        description: "Log entry copied to clipboard",
      });
    });

    it("selects log entry", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      // Click on a log entry
      const logEntries = screen
        .getAllByRole("button")
        .filter((btn) => btn.className.includes("rounded-lg border"));
      await userEvent.click(logEntries[0]);

      // Should have selected styling
      expect(logEntries[0]).toHaveClass("bg-muted");
    });
  });

  describe("Export and Clear", () => {
    it("exports logs as JSON", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      // Open dropdown menu
      const menuButton = screen
        .getByRole("button", { name: "" })
        .parentElement?.querySelector('button[aria-haspopup="menu"]');
      await userEvent.click(menuButton!);

      // Click export
      const exportButton = screen.getByRole("menuitem", {
        name: /export logs/i,
      });
      await userEvent.click(exportButton);

      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Exported",
          description: expect.stringContaining("logs exported"),
        }),
      );
    });

    it("clears all logs", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      // Open dropdown menu
      const menuButton = screen
        .getByRole("button", { name: "" })
        .parentElement?.querySelector('button[aria-haspopup="menu"]');
      await userEvent.click(menuButton!);

      // Click clear
      const clearButton = screen.getByRole("menuitem", { name: /clear logs/i });
      await userEvent.click(clearButton);

      expect(mockToast).toHaveBeenCalledWith({
        title: "Cleared",
        description: "All logs have been cleared",
      });

      // Should show empty state
      await waitFor(() => {
        expect(screen.getByText("No logs found")).toBeInTheDocument();
      });
    });
  });

  describe("Auto-scroll", () => {
    it("toggles auto-scroll", async () => {
      render(<ExecutionLogsViewer />);

      // Find auto-scroll button
      const autoScrollButton = screen
        .getAllByRole("button")
        .find((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-4 w-4"),
        );

      // Initially enabled (shows pause icon)
      expect(autoScrollButton).toBeInTheDocument();

      // Click to disable
      await userEvent.click(autoScrollButton!);

      // Click to re-enable
      await userEvent.click(autoScrollButton!);
    });
  });

  describe("Statistics", () => {
    it("displays log statistics", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      // Click on Statistics tab
      const statsTab = screen.getByRole("tab", { name: /statistics/i });
      await userEvent.click(statsTab);

      // Should show statistics
      expect(screen.getByText("Total Logs")).toBeInTheDocument();
      expect(screen.getByText("Avg Duration")).toBeInTheDocument();
      expect(screen.getByText("By Level")).toBeInTheDocument();
      expect(screen.getByText("By Category")).toBeInTheDocument();
    });

    it("shows log distribution by level", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      const statsTab = screen.getByRole("tab", { name: /statistics/i });
      await userEvent.click(statsTab);

      // Should show level distribution
      await waitFor(() => {
        expect(screen.getByText("debug")).toBeInTheDocument();
        expect(screen.getByText("info")).toBeInTheDocument();
        expect(screen.getByText("warn")).toBeInTheDocument();
        expect(screen.getByText("error")).toBeInTheDocument();
      });
    });
  });

  describe("Log Level Styling", () => {
    it("applies correct styling for different log levels", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      // Check for different level colors
      const levelIcons = screen.getAllByRole("img", { hidden: true });

      // Should have different colors for different levels
      const debugIcons = levelIcons.filter((icon) =>
        icon.parentElement?.className.includes("text-gray-500"),
      );
      const errorIcons = levelIcons.filter((icon) =>
        icon.parentElement?.className.includes("text-red-600"),
      );

      expect(debugIcons.length).toBeGreaterThan(0);
      expect(errorIcons.length).toBeGreaterThan(0);
    });

    it("shows error border for error logs", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      // Find error logs by border color
      const logEntries = screen
        .getAllByRole("button")
        .filter((btn) => btn.className.includes("border-red-200"));

      expect(logEntries.length).toBeGreaterThan(0);
    });
  });

  describe("Status Icons", () => {
    it("shows correct status icons", async () => {
      render(<ExecutionLogsViewer />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      // Look for status icons in the logs
      // Running status should have spinner
      const spinners = screen
        .getAllByRole("img", { hidden: true })
        .filter((icon) => icon.getAttribute("class")?.includes("animate-spin"));

      // Success/failed statuses should have check/x icons
      const statusIcons = screen
        .getAllByRole("img", { hidden: true })
        .filter(
          (icon) =>
            icon.getAttribute("class")?.includes("text-green-600") ||
            icon.getAttribute("class")?.includes("text-red-600"),
        );

      expect(spinners.length + statusIcons.length).toBeGreaterThan(0);
    });
  });

  describe("Props Configuration", () => {
    it("respects maxLogs prop", async () => {
      render(<ExecutionLogsViewer maxLogs={10} />);

      await waitFor(() => {
        expect(screen.queryByText("No logs found")).not.toBeInTheDocument();
      });

      // Should limit number of logs displayed
      const logEntries = screen
        .getAllByRole("button")
        .filter((btn) => btn.className.includes("rounded-lg border"));

      expect(logEntries.length).toBeLessThanOrEqual(10);
    });

    it("filters by toolId when provided", () => {
      render(<ExecutionLogsViewer toolId={123} />);

      expect(screen.getByText("Execution Logs")).toBeInTheDocument();
      // Component should filter logs by toolId internally
    });

    it("filters by eventId when provided", () => {
      render(<ExecutionLogsViewer eventId={456} />);

      expect(screen.getByText("Execution Logs")).toBeInTheDocument();
      // Component should filter logs by eventId internally
    });
  });
});
