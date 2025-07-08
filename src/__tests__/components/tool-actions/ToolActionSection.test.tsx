import React from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCError } from "@trpc/server";
import ToolActionSection, {
  type ToolActionConfig,
} from "@/components/event-form/ToolActionSection";
import { renderWithTrpc } from "@/__tests__/utils/trpc-test-utils";
import { type Tool } from "@/shared/schema";
import {
  ToolPluginRegistry,
  type ToolAction,
  type ActionType,
} from "@/components/tools/types/tool-plugin";
import { z } from "zod";

// Mock the toast hook
jest.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

// Mock ActionParameterForm
jest.mock("@/components/event-form/ActionParameterForm", () => ({
  __esModule: true,
  default: ({
    action,
    value,
    onChange,
    isTest,
  }: {
    action: ToolAction;
    value: Record<string, any>;
    onChange: (params: Record<string, any>) => void;
    isTest?: boolean;
  }) => (
    <div data-testid="action-parameter-form">
      <div data-testid="action-name">{action.name}</div>
      <div data-testid="parameter-values">{JSON.stringify(value)}</div>
      <button
        data-testid="update-parameters"
        onClick={() => onChange({ ...value, updated: true })}
      >
        Update Parameters
      </button>
      {isTest && <div data-testid="test-mode">Test Mode Active</div>}
    </div>
  ),
}));

// Create mock tool actions
const createMockAction = (overrides: Partial<ToolAction> = {}): ToolAction => ({
  id: "test-action-1",
  name: "Test Action",
  description: "A test action",
  category: "General",
  actionType: "create" as ActionType,
  developmentMode: "visual",
  inputSchema: z.object({
    message: z.string(),
    count: z.number().optional(),
  }),
  outputSchema: z.object({
    result: z.string(),
  }),
  execute: jest.fn().mockResolvedValue({ result: "success" }),
  testData: () => ({ message: "test message", count: 5 }),
  helpText: "This is a test action",
  examples: [
    {
      name: "Example 1",
      description: "First example",
      input: { message: "hello" },
      output: { result: "processed" },
    },
  ],
  ...overrides,
});

// Create mock tools
const mockTools: Tool[] = [
  {
    id: 1,
    userId: "user-1",
    name: "Slack Tool",
    type: "SLACK",
    credentials: { webhook: "https://slack.com/webhook" },
    description: "Slack integration",
    tags: ["messaging"],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 2,
    userId: "user-1",
    name: "Email Tool",
    type: "EMAIL",
    credentials: { smtp: "smtp.example.com" },
    description: "Email integration",
    tags: ["messaging"],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// Mock plugin with actions
const mockSlackPlugin = {
  id: "SLACK",
  name: "Slack",
  actions: [
    createMockAction({
      id: "slack-send-message",
      name: "Send Message",
      actionType: "create",
    }),
    createMockAction({
      id: "slack-update-message",
      name: "Update Message",
      actionType: "update",
    }),
  ],
  getActionById: jest.fn((id: string) => {
    return mockSlackPlugin.actions.find((a) => a.id === id);
  }),
};

const mockEmailPlugin = {
  id: "EMAIL",
  name: "Email",
  actions: [
    createMockAction({
      id: "email-send",
      name: "Send Email",
      actionType: "create",
    }),
  ],
  getActionById: jest.fn((id: string) => {
    return mockEmailPlugin.actions.find((a) => a.id === id);
  }),
};

// Mock handlers for tRPC calls
const mockHandlers = {
  tools: {
    executeAction: jest.fn(() => ({
      success: true,
      result: { message: "Action executed successfully" },
    })),
  },
};

describe("ToolActionSection", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
    ToolPluginRegistry.clear();
    ToolPluginRegistry.register(mockSlackPlugin as any);
    ToolPluginRegistry.register(mockEmailPlugin as any);
  });

  const renderComponent = (
    props: Partial<{
      value: ToolActionConfig | null;
      onChange: (config: ToolActionConfig | null) => void;
      availableTools: Tool[];
    }> = {},
  ) => {
    const defaultProps = {
      value: null,
      onChange: jest.fn(),
      availableTools: mockTools,
    };

    return renderWithTrpc(
      <ToolActionSection {...defaultProps} {...props} />,
      mockHandlers,
    );
  };

  describe("Initial Rendering", () => {
    it("renders the tool selection card", () => {
      renderComponent();

      expect(screen.getByText("Tool Selection")).toBeInTheDocument();
      expect(screen.getByLabelText("Select Tool")).toBeInTheDocument();
      expect(
        screen.getByText("Choose a tool to integrate..."),
      ).toBeInTheDocument();
    });

    it("displays available tools in the dropdown", async () => {
      renderComponent();

      const selectTrigger = screen.getByRole("combobox");
      await user.click(selectTrigger);

      await waitFor(() => {
        expect(screen.getByText("Slack Tool")).toBeInTheDocument();
        expect(screen.getByText("Email Tool")).toBeInTheDocument();
      });
    });

    it("shows no tools message when availableTools is empty", () => {
      renderComponent({ availableTools: [] });

      expect(
        screen.getByText(
          "No tools configured. Please configure tool credentials first.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Configure Tools")).toBeInTheDocument();
    });

    it("initializes with provided value", () => {
      const initialValue: ToolActionConfig = {
        toolType: "SLACK",
        actionId: "slack-send-message",
        toolId: 1,
        parameters: { message: "Initial message" },
      };

      renderComponent({ value: initialValue });

      // Should show selected tool
      expect(screen.getByText("Tool: Slack Tool (SLACK)")).toBeInTheDocument();

      // Should show action selection
      expect(screen.getByText("Action Selection")).toBeInTheDocument();

      // Should show selected action in parameter form
      expect(screen.getByTestId("action-name")).toHaveTextContent(
        "Send Message",
      );
      expect(screen.getByTestId("parameter-values")).toHaveTextContent(
        JSON.stringify({ message: "Initial message" }),
      );
    });
  });

  describe("Tool Selection", () => {
    it("handles tool selection", async () => {
      const onChange = jest.fn();
      renderComponent({ onChange });

      const selectTrigger = screen.getByRole("combobox");
      await user.click(selectTrigger);

      const slackOption = screen.getByText("Slack Tool");
      await user.click(slackOption);

      await waitFor(() => {
        expect(
          screen.getByText("Tool: Slack Tool (SLACK)"),
        ).toBeInTheDocument();
        expect(screen.getByText("Action Selection")).toBeInTheDocument();
      });

      // Should not call onChange yet (no action selected)
      expect(onChange).toHaveBeenCalledWith(null);
    });

    it("clears selection when changing tools", async () => {
      const onChange = jest.fn();
      const initialValue: ToolActionConfig = {
        toolType: "SLACK",
        actionId: "slack-send-message",
        toolId: 1,
        parameters: { message: "test" },
      };

      renderComponent({ value: initialValue, onChange });

      // Change to different tool
      const selectTrigger = screen.getByRole("combobox");
      await user.click(selectTrigger);

      const emailOption = screen.getByText("Email Tool");
      await user.click(emailOption);

      // Should clear previous selection
      expect(onChange).toHaveBeenCalledWith(null);
    });
  });

  describe("Action Selection", () => {
    it("displays available actions for selected tool", async () => {
      renderComponent();

      // Select Slack tool
      const toolSelect = screen.getByRole("combobox");
      await user.click(toolSelect);
      await user.click(screen.getByText("Slack Tool"));

      // Should show action selection
      await waitFor(() => {
        expect(screen.getByText("Action Selection")).toBeInTheDocument();
      });

      const actionSelect = screen.getAllByRole("combobox")[1];
      await user.click(actionSelect);

      await waitFor(() => {
        expect(screen.getByText("Send Message")).toBeInTheDocument();
        expect(screen.getByText("Update Message")).toBeInTheDocument();
      });
    });

    it("handles action selection and shows parameters", async () => {
      const onChange = jest.fn();
      renderComponent({ onChange });

      // Select tool
      const toolSelect = screen.getByRole("combobox");
      await user.click(toolSelect);
      await user.click(screen.getByText("Slack Tool"));

      // Select action
      await waitFor(() => {
        expect(screen.getByText("Action Selection")).toBeInTheDocument();
      });

      const actionSelect = screen.getAllByRole("combobox")[1];
      await user.click(actionSelect);
      await user.click(screen.getByText("Send Message"));

      await waitFor(() => {
        expect(screen.getByText("Action Parameters")).toBeInTheDocument();
        expect(screen.getByTestId("action-parameter-form")).toBeInTheDocument();
      });

      // Should call onChange with default test data
      expect(onChange).toHaveBeenCalledWith({
        toolType: "SLACK",
        actionId: "slack-send-message",
        toolId: 1,
        parameters: { message: "test message", count: 5 },
      });
    });

    it("displays action metadata", async () => {
      renderComponent();

      // Select tool and action
      const toolSelect = screen.getByRole("combobox");
      await user.click(toolSelect);
      await user.click(screen.getByText("Slack Tool"));

      await waitFor(() => {
        const actionSelect = screen.getAllByRole("combobox")[1];
        return actionSelect;
      });

      const actionSelect = screen.getAllByRole("combobox")[1];
      await user.click(actionSelect);
      await user.click(screen.getByText("Send Message"));

      await waitFor(() => {
        expect(
          screen.getByText("Description: A test action"),
        ).toBeInTheDocument();
        expect(screen.getByText("Category: General")).toBeInTheDocument();
        expect(
          screen.getByText("Help: This is a test action"),
        ).toBeInTheDocument();
      });
    });

    it("shows correct badge colors for action types", async () => {
      renderComponent();

      const toolSelect = screen.getByRole("combobox");
      await user.click(toolSelect);
      await user.click(screen.getByText("Slack Tool"));

      await waitFor(() => {
        const actionSelect = screen.getAllByRole("combobox")[1];
        return actionSelect;
      });

      const actionSelect = screen.getAllByRole("combobox")[1];
      await user.click(actionSelect);

      // Check badge colors for different action types
      const badges = screen.getAllByText(/create|update/i);
      expect(badges).toHaveLength(2);
    });
  });

  describe("Parameter Handling", () => {
    it("updates parameters when changed", async () => {
      const onChange = jest.fn();
      renderComponent({ onChange });

      // Select tool and action
      const toolSelect = screen.getByRole("combobox");
      await user.click(toolSelect);
      await user.click(screen.getByText("Slack Tool"));

      await waitFor(() => {
        const actionSelect = screen.getAllByRole("combobox")[1];
        return actionSelect;
      });

      const actionSelect = screen.getAllByRole("combobox")[1];
      await user.click(actionSelect);
      await user.click(screen.getByText("Send Message"));

      // Update parameters
      await waitFor(() => {
        expect(screen.getByTestId("update-parameters")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("update-parameters"));

      expect(onChange).toHaveBeenLastCalledWith({
        toolType: "SLACK",
        actionId: "slack-send-message",
        toolId: 1,
        parameters: { message: "test message", count: 5, updated: true },
      });
    });
  });

  describe("Test Action Execution", () => {
    it("executes test action successfully", async () => {
      const { toast } = jest
        .requireMock("@/components/ui/use-toast")
        .useToast();
      renderComponent();

      // Select tool and action
      const toolSelect = screen.getByRole("combobox");
      await user.click(toolSelect);
      await user.click(screen.getByText("Slack Tool"));

      await waitFor(() => {
        const actionSelect = screen.getAllByRole("combobox")[1];
        return actionSelect;
      });

      const actionSelect = screen.getAllByRole("combobox")[1];
      await user.click(actionSelect);
      await user.click(screen.getByText("Send Message"));

      // Click test button
      await waitFor(() => {
        expect(screen.getByText("Test Action")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Test Action"));

      await waitFor(() => {
        expect(mockHandlers.tools.executeAction).toHaveBeenCalledWith({
          toolId: 1,
          actionId: "slack-send-message",
          parameters: { message: "test message", count: 5 },
          isTest: true,
        });
      });

      expect(toast).toHaveBeenCalledWith({
        title: "Test Successful",
        description: "Action executed successfully in test mode",
      });
    });

    it("handles test action failure", async () => {
      const { toast } = jest
        .requireMock("@/components/ui/use-toast")
        .useToast();

      // Mock failure
      mockHandlers.tools.executeAction = jest.fn().mockRejectedValue(
        new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Test execution failed",
        }),
      );

      renderComponent();

      // Select tool and action
      const toolSelect = screen.getByRole("combobox");
      await user.click(toolSelect);
      await user.click(screen.getByText("Slack Tool"));

      await waitFor(() => {
        const actionSelect = screen.getAllByRole("combobox")[1];
        return actionSelect;
      });

      const actionSelect = screen.getAllByRole("combobox")[1];
      await user.click(actionSelect);
      await user.click(screen.getByText("Send Message"));

      // Click test button
      await waitFor(() => {
        expect(screen.getByText("Test Action")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Test Action"));

      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith({
          title: "Test Failed",
          description: "Test execution failed",
          variant: "destructive",
        });
      });
    });

    it("disables test button during execution", async () => {
      // Mock slow execution
      mockHandlers.tools.executeAction = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ success: true }), 100),
            ),
        );

      renderComponent();

      // Select tool and action
      const toolSelect = screen.getByRole("combobox");
      await user.click(toolSelect);
      await user.click(screen.getByText("Slack Tool"));

      await waitFor(() => {
        const actionSelect = screen.getAllByRole("combobox")[1];
        return actionSelect;
      });

      const actionSelect = screen.getAllByRole("combobox")[1];
      await user.click(actionSelect);
      await user.click(screen.getByText("Send Message"));

      const testButton = await screen.findByText("Test Action");
      await user.click(testButton);

      // Button should be disabled during execution
      expect(testButton.closest("button")).toBeDisabled();

      // Wait for execution to complete
      await waitFor(() => {
        expect(testButton.closest("button")).not.toBeDisabled();
      });
    });
  });

  describe("Edge Cases", () => {
    it("handles missing plugin gracefully", () => {
      ToolPluginRegistry.clear();

      const initialValue: ToolActionConfig = {
        toolType: "NONEXISTENT",
        actionId: "missing-action",
        toolId: 99,
        parameters: {},
      };

      renderComponent({ value: initialValue });

      // Should not crash, but show tool selection
      expect(screen.getByText("Tool Selection")).toBeInTheDocument();
    });

    it("handles missing action gracefully", () => {
      const initialValue: ToolActionConfig = {
        toolType: "SLACK",
        actionId: "nonexistent-action",
        toolId: 1,
        parameters: {},
      };

      renderComponent({ value: initialValue });

      // Should show tool but not action parameters
      expect(screen.getByText("Tool: Slack Tool (SLACK)")).toBeInTheDocument();
      expect(screen.queryByText("Action Parameters")).not.toBeInTheDocument();
    });

    it("handles empty actions array", async () => {
      // Register plugin with no actions
      ToolPluginRegistry.clear();
      ToolPluginRegistry.register({
        id: "EMPTY",
        name: "Empty Plugin",
        actions: [],
        getActionById: jest.fn(),
      } as any);

      const emptyTool: Tool = {
        id: 3,
        userId: "user-1",
        name: "Empty Tool",
        type: "EMPTY",
        credentials: {},
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      renderComponent({ availableTools: [emptyTool] });

      const toolSelect = screen.getByRole("combobox");
      await user.click(toolSelect);
      await user.click(screen.getByText("Empty Tool"));

      // Should not show action selection
      expect(screen.queryByText("Action Selection")).not.toBeInTheDocument();
    });
  });

  describe("Integration", () => {
    it("handles full workflow from tool selection to parameter update", async () => {
      const onChange = jest.fn();
      renderComponent({ onChange });

      // 1. Select tool
      const toolSelect = screen.getByRole("combobox");
      await user.click(toolSelect);
      await user.click(screen.getByText("Email Tool"));

      // 2. Select action
      await waitFor(() => {
        expect(screen.getByText("Action Selection")).toBeInTheDocument();
      });

      const actionSelect = screen.getAllByRole("combobox")[1];
      await user.click(actionSelect);
      await user.click(screen.getByText("Send Email"));

      // 3. Verify initial call
      expect(onChange).toHaveBeenCalledWith({
        toolType: "EMAIL",
        actionId: "email-send",
        toolId: 2,
        parameters: { message: "test message", count: 5 },
      });

      // 4. Update parameters
      await user.click(screen.getByTestId("update-parameters"));

      // 5. Verify updated call
      expect(onChange).toHaveBeenLastCalledWith({
        toolType: "EMAIL",
        actionId: "email-send",
        toolId: 2,
        parameters: { message: "test message", count: 5, updated: true },
      });
    });
  });
});
