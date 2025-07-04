import * as React from "react";
import { screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { renderWithTrpc } from "@/__tests__/utils/trpc-test-utils";

// Define a Tool type for our tests
interface Tool {
  id: number;
  userId: string;
  name: string;
  type: string;
  isActive: boolean;
  credentials: string;
  createdAt: Date;
  updatedAt: Date;
}

// Define a partial type for stats to avoid strict typing issues
interface ToolsStats {
  totalTools: number;
  activeTools: number;
  inactiveTools: number;
  byType: Record<string, number>;
}

// Define mock tools with proper typing
const mockTools: Tool[] = [
  {
    id: 1,
    userId: "user-1",
    name: "Slack Notifications",
    type: "SLACK",
    isActive: true,
    credentials: JSON.stringify({
      webhookUrl: "https://hooks.slack.com/test",
      channel: "#general",
      username: "Cronium Bot",
    }),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-15T10:30:00Z"),
  },
  {
    id: 2,
    userId: "user-1",
    name: "Email Alerts",
    type: "EMAIL",
    isActive: false,
    credentials: JSON.stringify({
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUser: "test@example.com",
      smtpPassword: "[HIDDEN]",
      fromEmail: "test@example.com",
      fromName: "Cronium System",
      enableTLS: true,
    }),
    createdAt: new Date("2024-01-02T00:00:00Z"),
    updatedAt: new Date("2024-01-10T15:45:00Z"),
  },
];

// Create the mock data structure that matches the expected output
const mockToolsData = {
  tools: mockTools,
  total: 2,
  hasMore: false,
};

const mockStatsData: ToolsStats = {
  totalTools: 2,
  activeTools: 1,
  inactiveTools: 1,
  byType: {
    SLACK: 1,
    EMAIL: 1,
    DISCORD: 0,
    WEBHOOK: 0,
    HTTP: 0,
  },
};

// Import the actual component
import { ModularToolsManager } from "@/components/tools/modular-tools-manager";

// Mock the toast hook
jest.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

// Mock superjson to avoid import issues
jest.mock("superjson", () => ({
  serialize: jest.fn((data) => ({ json: data, meta: undefined })),
  deserialize: jest.fn((data) => data.json),
}));

describe("ModularToolsManager", () => {
  const user = userEvent.setup();

  const renderComponent = () => {
    // Mock handlers for tRPC
    const mockHandlers = {
      tools: {
        getAll: jest.fn(() => mockToolsData),
        getStats: jest.fn(() => mockStatsData),
        create: jest.fn(() => ({ id: 3, name: "New Tool" })),
        update: jest.fn(() => ({ id: 1, name: "Updated Tool" })),
        delete: jest.fn(() => ({ success: true })),
        testConnection: jest.fn(() => ({
          success: true,
          message: "Connection test successful",
        })),
      },
      integrations: {
        templates: {
          create: jest.fn(() => ({ id: 1, name: "New Template" })),
        },
      },
    };

    return renderWithTrpc(<ModularToolsManager />, mockHandlers);
  };

  it("renders without crashing", async () => {
    renderComponent();

    // Just verify the component renders without errors and shows basic UI
    await waitFor(() => {
      expect(screen.getByText(/Total Tools/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Active Tools/)).toBeInTheDocument();
    expect(screen.getByText(/Inactive Tools/)).toBeInTheDocument();
  });

  it("renders tools manager with stats and tool list", async () => {
    renderComponent();

    // Check stats cards are rendered
    await waitFor(() => {
      expect(screen.getByText(/Total Tools/)).toBeInTheDocument();
      expect(screen.getByText(/Active Tools/)).toBeInTheDocument();
      expect(screen.getByText(/Inactive Tools/)).toBeInTheDocument();
    });

    // Check that the Available Tools section is shown
    expect(screen.getByText(/Available Tools/)).toBeInTheDocument();
  });

  it("displays basic component structure", async () => {
    renderComponent();

    // Just verify the component renders the basic structure
    await waitFor(() => {
      expect(screen.getByText(/Available Tools/)).toBeInTheDocument();
    });

    // Check that stats cards show the expected values from mock data
    expect(screen.getByText("2")).toBeInTheDocument(); // Total Tools
    const onesElements = screen.getAllByText("1");
    expect(onesElements).toHaveLength(2); // Active Tools and Inactive Tools both show 1
  });

  it("shows available tools section", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Available Tools/)).toBeInTheDocument();
    });

    // The component should render the Available Tools section
    expect(screen.getByText(/Available Tools/)).toBeInTheDocument();
  });

  it("handles component rendering gracefully", async () => {
    renderComponent();

    // Wait for component to be in a stable state
    await waitFor(() => {
      expect(screen.getByText(/Total Tools/)).toBeInTheDocument();
    });

    // Component should handle empty or no tools gracefully
    expect(screen.getByText(/Available Tools/)).toBeInTheDocument();
  });
});
