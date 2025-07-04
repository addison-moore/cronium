import React from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCError } from "@trpc/server";
import EventForm from "@/components/event-form/EventForm";
import {
  EventStatus,
  EventType,
  RunLocation,
  TimeUnit,
  EventTriggerType,
  ConditionalActionType,
} from "@/shared/schema";
import { renderWithTrpc } from "@/__tests__/utils/trpc-test-utils";

// Mock the toast hook
jest.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

// Mock next-intl
jest.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string): string =>
      key,
}));

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
  }),
}));

// Mock script templates
jest.mock("@/lib/scriptTemplates", () => ({
  getDefaultScriptContent: (type: string): string => `# Default ${type} script`,
  getDefaultHttpRequest: (): {
    method: string;
    url: string;
    headers: any[];
    body: string;
  } => ({
    method: "GET",
    url: "",
    headers: [],
    body: "",
  }),
}));

// Mock child components
jest.mock("@/components/ui/monaco-editor", () => ({
  MonacoEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
    language: string;
  }) => (
    <div data-testid="monaco-editor">
      <textarea
        data-testid="monaco-editor-textarea"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  ),
}));

jest.mock("@/components/ui/tags-input", () => ({
  TagsInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string[];
    onChange?: (value: string[]) => void;
    placeholder?: string;
  }) => (
    <input
      data-testid="tags-input"
      value={value.join(", ")}
      onChange={(e) => onChange?.(e.target.value.split(", ").filter(Boolean))}
      placeholder={placeholder}
    />
  ),
}));

jest.mock("@/components/dashboard/AIScriptAssistant", () => ({
  __esModule: true,
  default: ({
    onGenerateScript,
  }: {
    onGenerateScript: (script: string) => void;
  }): React.ReactElement => (
    <div data-testid="ai-assistant">
      <button
        data-testid="generate-script-button"
        onClick={() =>
          onGenerateScript('# AI Generated Script\nprint("Hello from AI")')
        }
      >
        Generate Script
      </button>
    </div>
  ),
}));

jest.mock("@/components/event-form/ConditionalActionsSection", () => ({
  __esModule: true,
  default: ({
    onConditionalActionsChange,
  }: {
    eventData?: any;
    availableEvents?: any[];
    eventId?: number;
    onConditionalActionsChange: (
      actions: Array<{
        type: "ON_SUCCESS" | "ON_FAILURE" | "ALWAYS" | "ON_CONDITION";
        action: ConditionalActionType;
        emailAddresses?: string;
        emailSubject?: string;
        targetEventId?: number | null;
        toolId?: number;
        message?: string;
      }>,
    ) => void;
  }) => (
    <div data-testid="conditional-actions">
      <button
        onClick={() =>
          onConditionalActionsChange([
            {
              type: "ON_SUCCESS",
              action: ConditionalActionType.SEND_MESSAGE,
              emailAddresses: "test@example.com",
            },
          ])
        }
      >
        Add Conditional Action
      </button>
    </div>
  ),
}));

jest.mock("@/components/event-form/EditorSettingsModal", () => ({
  __esModule: true,
  default: ({
    isOpen,
    onClose,
    onSettingsChange,
    currentSettings,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSettingsChange: (settings: {
      fontSize: number;
      theme: string;
      wordWrap: boolean;
      minimap: boolean;
      lineNumbers: boolean;
    }) => void;
    currentSettings?: {
      fontSize: number;
      theme: string;
      wordWrap: boolean;
      minimap: boolean;
      lineNumbers: boolean;
    };
  }) => {
    const settings = currentSettings || {
      fontSize: 14,
      theme: "vs-dark",
      wordWrap: true,
      minimap: false,
      lineNumbers: true,
    };

    if (!isOpen) return null;
    return (
      <div data-testid="editor-settings-modal">
        <button onClick={onClose}>Close</button>
        <button
          onClick={() =>
            onSettingsChange({
              ...settings,
              fontSize: 16,
            })
          }
        >
          Change Settings
        </button>
      </div>
    );
  },
}));

// Mock handlers for tRPC calls
const mockHandlers = {
  servers: {
    getAll: jest.fn(() => ({
      servers: [
        {
          id: 1,
          name: "Server 1",
          address: "server1.com",
          port: 22,
          username: "user1",
          online: true,
        },
        {
          id: 2,
          name: "Server 2",
          address: "server2.com",
          port: 22,
          username: "user2",
          online: true,
        },
      ],
      total: 2,
      hasMore: false,
    })),
  },
  events: {
    getAll: jest.fn(() => ({
      events: [
        { id: 1, name: "Event 1", type: EventType.PYTHON, description: null },
        { id: 2, name: "Event 2", type: EventType.NODEJS, description: null },
      ],
      total: 2,
      hasMore: false,
    })),
    create: jest.fn((input) => ({ id: 3, ...input })),
    update: jest.fn((input) => ({ ...input })),
  },
  settings: {
    getEditorSettings: jest.fn(() => ({
      fontSize: 14,
      theme: "vs-dark",
      wordWrap: true,
      minimap: false,
      lineNumbers: true,
    })),
    updateEditorSettings: jest.fn((input) => input),
  },
};

// Don't mock tRPC globally - use renderWithTrpc instead

describe("EventForm", () => {
  const user = userEvent.setup();

  const mockEventData = {
    id: 1,
    name: "Test Event",
    description: "Test description",
    type: EventType.PYTHON,
    content: 'print("hello")',
    status: EventStatus.DRAFT,
    triggerType: EventTriggerType.MANUAL,
    runLocation: RunLocation.LOCAL,
    timeoutValue: 30,
    timeoutUnit: TimeUnit.SECONDS,
    retries: 0,
    tags: ["test"],
    envVars: [{ key: "TEST_VAR", value: "test_value" }],
    shared: false,
    scheduleNumber: 5,
    scheduleUnit: TimeUnit.MINUTES,
    maxExecutions: 0,
    resetCounterOnActive: false,
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
  });

  interface EventFormProps {
    initialScript?: any;
    initialData?: any;
    isEditing?: boolean;
    eventId?: number;
    onSuccess?: (eventId?: number) => void;
  }

  const renderComponent = (props: Partial<EventFormProps> = {}) => {
    return renderWithTrpc(<EventForm {...props} />, mockHandlers);
  };

  it("renders the form with default values", () => {
    renderComponent();

    expect(screen.getByLabelText("Fields.Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Fields.Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Fields.Type")).toBeInTheDocument();
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.getByText("CreateEvent")).toBeInTheDocument();
  });

  it("renders with initial event data for editing", () => {
    renderComponent({
      initialData: mockEventData,
      isEditing: true,
      eventId: 1,
    });

    expect(screen.getByDisplayValue("Test Event")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test description")).toBeInTheDocument();
    expect(screen.getByDisplayValue('print("hello")')).toBeInTheDocument();
    expect(screen.getByText("UpdateEvent")).toBeInTheDocument();
  });

  it("handles event type changes", async () => {
    renderComponent();

    const typeSelect = screen.getByLabelText("Fields.Type");
    await user.click(typeSelect);

    const httpOption = screen.getByText("Types.HttpRequest");
    await user.click(httpOption);

    // Should show HTTP request configuration
    expect(screen.getByText("HttpRequestConfiguration")).toBeInTheDocument();
    expect(screen.getByText("Method")).toBeInTheDocument();
    expect(screen.getByText("URL")).toBeInTheDocument();
  });

  it("handles trigger type changes", async () => {
    renderComponent();

    const triggerSelect = screen.getByLabelText("Fields.TriggerType");
    await user.click(triggerSelect);

    const scheduleOption = screen.getByText("TriggerTypes.Schedule");
    await user.click(scheduleOption);

    // Should show schedule settings
    expect(screen.getByText("ScheduleSettings")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Fields.ScheduleInterval"),
    ).toBeInTheDocument();
  });

  it("handles run location changes", async () => {
    renderComponent();

    const locationSelect = screen.getByLabelText("Fields.RunLocations.Label");
    await user.click(locationSelect);

    const remoteOption = screen.getByText("Fields.RunLocations.Remote");
    await user.click(remoteOption);

    // Should show server selection
    expect(screen.getByText("Fields.Servers")).toBeInTheDocument();
    expect(screen.getByText("Server 1 (server1.com)")).toBeInTheDocument();
    expect(screen.getByText("Server 2 (server2.com)")).toBeInTheDocument();
  });

  it("handles environment variables", async () => {
    renderComponent({ initialData: mockEventData });

    // Should show existing env var
    expect(screen.getByDisplayValue("TEST_VAR")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test_value")).toBeInTheDocument();

    // Add new env var
    const addButton = screen.getByText("Add Environment Variable");
    await user.click(addButton);

    const keyInputs = screen.getAllByPlaceholderText("Variable name");
    const valueInputs = screen.getAllByPlaceholderText("Variable value");

    expect(keyInputs).toHaveLength(2);
    expect(valueInputs).toHaveLength(2);
  });

  it("handles cron scheduling toggle", async () => {
    renderComponent();

    // Enable schedule trigger first
    const triggerSelect = screen.getByLabelText("Fields.TriggerType");
    await user.click(triggerSelect);
    await user.click(screen.getByText("TriggerTypes.Schedule"));

    // Toggle cron scheduling
    const cronToggle = screen.getByLabelText("Use Cron Scheduling");
    await user.click(cronToggle);

    // Should show cron expression input
    expect(screen.getByLabelText("Cron Expression")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("0 */5 * * * (every 5 minutes)"),
    ).toBeInTheDocument();
  });

  it("handles AI script generation", async () => {
    renderComponent();

    // Wait for the component to fully render
    await waitFor(() => {
      expect(screen.getByTestId("ai-assistant")).toBeInTheDocument();
    });

    const generateButton = screen.getByTestId("generate-script-button");
    await user.click(generateButton);

    // Wait for the editor to update
    await waitFor(() => {
      const editorTextarea = screen.getByTestId("monaco-editor-textarea");
      expect(editorTextarea).toHaveValue(
        '# AI Generated Script\nprint("Hello from AI")',
      );
    });
  });

  it("handles editor settings", async () => {
    // Mock the editor settings mutation
    const mockUpdateSettings = jest.fn().mockResolvedValue({
      fontSize: 16,
      theme: "vs-dark",
      wordWrap: true,
      minimap: false,
      lineNumbers: true,
    });

    // Update the mock handlers to include the updateEditorSettings mutation
    mockHandlers.settings.updateEditorSettings = mockUpdateSettings;

    renderComponent();

    // Wait for the component to fully render
    await waitFor(() => {
      expect(screen.getByText("EditorSettings")).toBeInTheDocument();
    });

    const settingsButton = screen.getByText("EditorSettings");
    await user.click(settingsButton);

    expect(screen.getByTestId("editor-settings-modal")).toBeInTheDocument();

    const changeButton = screen.getByText("Change Settings");
    await user.click(changeButton);

    // Wait for the mutation to be called
    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalled();
    });

    const closeButton = screen.getByText("Close");
    await user.click(closeButton);

    expect(
      screen.queryByTestId("editor-settings-modal"),
    ).not.toBeInTheDocument();
  });

  it("handles form submission for new event", async () => {
    const mockCreate = jest.fn().mockResolvedValue({ id: 123 });
    const mockOnSuccess = jest.fn();

    // Update the mock handlers
    mockHandlers.events.create = mockCreate;

    renderComponent({ onSuccess: mockOnSuccess });

    // Fill in required fields
    await user.type(screen.getByLabelText("Fields.EventName"), "New Event");
    await user.type(
      screen.getByLabelText("Fields.Description"),
      "New description",
    );

    // Submit form
    const submitButton = screen.getByText("CreateEvent");
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New Event",
          description: "New description",
          type: EventType.PYTHON,
          status: EventStatus.DRAFT,
        }),
      );
    });

    expect(mockOnSuccess).toHaveBeenCalledWith(123);
  });

  it("handles form submission for editing event", async () => {
    const mockUpdate = jest.fn().mockResolvedValue({ id: 1 });
    const mockOnSuccess = jest.fn();

    // Update the mock handlers
    mockHandlers.events.update = mockUpdate;

    renderComponent({
      initialData: mockEventData,
      isEditing: true,
      eventId: 1,
      onSuccess: mockOnSuccess,
    });

    // Modify the name
    const nameInput = screen.getByDisplayValue("Test Event");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Event");

    // Submit form
    const submitButton = screen.getByText("UpdateEvent");
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          name: "Updated Event",
        }),
      );
    });

    expect(mockOnSuccess).toHaveBeenCalledWith(1);
  });

  it("handles HTTP request configuration", async () => {
    renderComponent();

    // Change to HTTP request type
    const typeSelect = screen.getByLabelText("Fields.Type");
    await user.click(typeSelect);
    await user.click(screen.getByText("Types.HttpRequest"));

    // Configure HTTP request
    const methodSelect = screen.getByDisplayValue("GET");
    await user.click(methodSelect);
    await user.click(screen.getByText("POST"));

    const urlInput = screen.getByPlaceholderText(
      "https://api.example.com/endpoint",
    );
    await user.type(urlInput, "https://api.test.com/data");

    // Add header
    const addHeaderButton = screen.getByText("Add Header");
    await user.click(addHeaderButton);

    const headerKeyInput = screen.getByPlaceholderText("Header name");
    const headerValueInput = screen.getByPlaceholderText("Header value");

    await user.type(headerKeyInput, "Content-Type");
    await user.type(headerValueInput, "application/json");

    // Should show body editor for POST
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  it("handles conditional actions", async () => {
    // Define mock events for the test
    const mockEvents = [
      { id: 1, name: "Event 1", type: EventType.PYTHON, description: null },
      { id: 2, name: "Event 2", type: EventType.NODEJS, description: null },
    ];

    // Update mock handlers for tools and events
    const mockTools = { tools: [], total: 0, hasMore: false };
    const mockEventsData = { events: mockEvents, total: 2, hasMore: false };

    // These will be handled by the renderWithTrpc utility

    renderComponent();

    // Wait for the component to fully render
    await waitFor(() => {
      expect(screen.getByTestId("conditional-actions")).toBeInTheDocument();
    });

    const addActionButton = screen.getByText("Add Conditional Action");
    await user.click(addActionButton);

    // Should set conditional actions
    expect(screen.getByTestId("conditional-actions")).toBeInTheDocument();
  });

  it("handles validation errors gracefully", async () => {
    const mockCreate = jest.fn().mockRejectedValue(
      new TRPCError({
        code: "BAD_REQUEST",
        message: "Validation failed",
      }),
    );

    // Update the mock handlers
    mockHandlers.events.create = mockCreate;

    renderComponent();

    // Submit with minimal data
    const submitButton = screen.getByText("CreateEvent");
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });

    // Form should handle the error gracefully
    expect(submitButton).toBeEnabled();
  });

  it("handles server selection for remote execution", async () => {
    renderComponent();

    // Open server selection
    const serverButton = screen.getByText("Servers.SelectServers");
    await user.click(serverButton);

    // Select servers by test ID instead of label
    const server1Checkbox = screen.getByTestId("server-checkbox-1");
    const server2Checkbox = screen.getByTestId("server-checkbox-2");

    await user.click(server1Checkbox);
    await user.click(server2Checkbox);

    // Close the dialog
    const closeButton = screen.getByText("Common.Close");
    await user.click(closeButton);

    // Should show selected servers count
    expect(screen.getByText("Servers.SelectedCount: 2")).toBeInTheDocument();
  });

  it("handles numeric input validation", async () => {
    renderComponent();

    // Wait for the component to fully render
    await waitFor(() => {
      expect(screen.getByText("CreateEvent")).toBeInTheDocument();
    });

    // Find the timeout input by placeholder instead of test ID
    const timeoutInput = screen.getByPlaceholderText(
      "Fields.TimeoutPlaceholder",
    );

    // Clear and type invalid value
    await user.clear(timeoutInput);
    await user.type(timeoutInput, "-5");

    // Submit the form
    const submitButton = screen.getByText("CreateEvent");
    await user.click(submitButton);

    // Should show validation error
    await waitFor(() => {
      expect(
        screen.getByText("Validation.TimeoutPositive"),
      ).toBeInTheDocument();
    });

    // Fix the value
    await user.clear(timeoutInput);
    await user.type(timeoutInput, "60");

    // Clear again to test empty value
    await user.clear(timeoutInput);

    // Should reset to default value - use toHaveValue with number since the input might be numeric
    expect(timeoutInput).toHaveValue(30);
  });

  it("handles password visibility toggle for env vars", async () => {
    renderComponent({ initialData: mockEventData });

    const passwordInput = screen.getByDisplayValue("test_value");
    expect(passwordInput).toHaveAttribute("type", "password");

    // Find and click the eye icon
    const eyeButton = passwordInput.parentElement?.querySelector("button");
    if (eyeButton) {
      await user.click(eyeButton);
      expect(passwordInput).toHaveAttribute("type", "text");
    }
  });

  it("prevents double submission", async () => {
    const mockCreate = jest
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({ id: 123 }), 100)),
      );

    // Update the mock handlers
    mockHandlers.events.create = mockCreate;

    renderComponent();

    // Wait for the component to fully render
    await waitFor(() => {
      expect(screen.getByText("CreateEvent")).toBeInTheDocument();
    });

    // Fill in required fields first using placeholder instead of label
    const nameInput = screen.getByPlaceholderText("Placeholders.EventName");
    await user.type(nameInput, "Test Event");

    const submitButton = screen.getByText("CreateEvent");

    // Submit the form
    await user.click(submitButton);

    // Wait for the mutation to be called
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    // Verify the form submission is in progress
    expect(submitButton).toBeDisabled();

    // Try clicking again (this should have no effect since button is disabled)
    await user.click(submitButton);
    await user.click(submitButton);

    // Should still only call create once
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Wait for the submission to complete and verify the data
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Test Event",
          type: EventType.PYTHON,
          status: EventStatus.DRAFT,
        }),
      );
    });
  });
});
