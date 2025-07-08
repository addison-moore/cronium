import React from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@testing-library/react";
import ActionParameterForm from "@/components/event-form/ActionParameterForm";
import {
  type ToolAction,
  type ActionType,
} from "@/components/tools/types/tool-plugin";
import { z } from "zod";

// Create mock tool action
const createMockAction = (overrides: Partial<ToolAction> = {}): ToolAction => ({
  id: "test-action",
  name: "Test Action",
  description: "A test action",
  category: "Test",
  actionType: "create" as ActionType,
  developmentMode: "visual",
  inputSchema: z.object({
    message: z.string(),
    count: z.number().min(0),
  }),
  outputSchema: z.object({
    result: z.string(),
  }),
  execute: jest.fn(),
  testData: () => ({ message: "test", count: 5 }),
  examples: [
    {
      name: "Example 1",
      description: "First example",
      input: { message: "hello", count: 10 },
      output: { result: "success" },
    },
  ],
  ...overrides,
});

describe("ActionParameterForm", () => {
  const user = userEvent.setup();

  const renderComponent = (
    props: Partial<{
      action: ToolAction;
      value: Record<string, any>;
      onChange: (params: Record<string, any>) => void;
      isTest?: boolean;
    }> = {},
  ) => {
    const defaultProps = {
      action: createMockAction(),
      value: {},
      onChange: jest.fn(),
      isTest: false,
    };

    return render(<ActionParameterForm {...defaultProps} {...props} />);
  };

  describe("Basic Rendering", () => {
    it("renders string fields correctly", () => {
      const action = createMockAction();
      renderComponent({ action, value: { message: "", count: 0 } });

      expect(screen.getByLabelText(/message/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/count/i)).toBeInTheDocument();
    });

    it("shows required badges for required fields", () => {
      const action = createMockAction({
        inputSchema: z.object({
          required: z.string(),
          optional: z.string().optional(),
        }),
      });

      renderComponent({ action, value: {} });

      const requiredField = screen.getByText("required").closest("div");
      expect(within(requiredField!).getByText("Required")).toBeInTheDocument();

      const optionalField = screen.getByText("optional").closest("div");
      expect(
        within(optionalField!).queryByText("Required"),
      ).not.toBeInTheDocument();
    });

    it("shows test mode alert when isTest is true", () => {
      renderComponent({ isTest: true });

      expect(
        screen.getByText(/Test mode: Actions will be executed safely/),
      ).toBeInTheDocument();
    });

    it("shows no parameters message for empty schema", () => {
      const action = createMockAction({
        inputSchema: z.object({}),
      });

      renderComponent({ action });

      expect(
        screen.getByText(/This action doesn't require any parameters/),
      ).toBeInTheDocument();
    });
  });

  describe("Field Types", () => {
    it("renders email fields with email input type", () => {
      const action = createMockAction({
        inputSchema: z.object({
          email: z.string().email(),
        }),
      });

      renderComponent({ action, value: { email: "" } });

      const emailInput = screen.getByLabelText(/email/i);
      expect(emailInput).toHaveAttribute("type", "email");
      expect(screen.getByText("Email")).toBeInTheDocument(); // Badge
    });

    it("renders multiline text as textarea", () => {
      const action = createMockAction({
        inputSchema: z.object({
          description: z.string().min(101), // > 100 chars triggers multiline
        }),
      });

      renderComponent({ action, value: { description: "" } });

      const textarea = screen.getByPlaceholderText(/Enter description/);
      expect(textarea.tagName).toBe("TEXTAREA");
    });

    it("renders number fields correctly", () => {
      const action = createMockAction({
        inputSchema: z.object({
          quantity: z.number(),
        }),
      });

      renderComponent({ action, value: { quantity: 0 } });

      const numberInput = screen.getByLabelText(/quantity/i);
      expect(numberInput).toHaveAttribute("type", "number");
      expect(screen.getByText("Number")).toBeInTheDocument(); // Badge
    });

    it("renders boolean fields as switches", () => {
      const action = createMockAction({
        inputSchema: z.object({
          enabled: z.boolean(),
        }),
      });

      renderComponent({ action, value: { enabled: false } });

      const switchElement = screen.getByRole("switch");
      expect(switchElement).toBeInTheDocument();
      expect(screen.getByLabelText(/enabled/i)).toBeInTheDocument();
    });

    it("renders enum fields as select", () => {
      const action = createMockAction({
        inputSchema: z.object({
          priority: z.enum(["low", "medium", "high"]),
        }),
      });

      renderComponent({ action, value: { priority: "medium" } });

      const selectTrigger = screen.getByRole("combobox");
      expect(selectTrigger).toBeInTheDocument();
      expect(screen.getByText("Select")).toBeInTheDocument(); // Badge
    });

    it("renders array fields with add/remove buttons", () => {
      const action = createMockAction({
        inputSchema: z.object({
          tags: z.array(z.string()),
        }),
      });

      renderComponent({ action, value: { tags: ["tag1", "tag2"] } });

      expect(screen.getByDisplayValue("tag1")).toBeInTheDocument();
      expect(screen.getByDisplayValue("tag2")).toBeInTheDocument();
      expect(screen.getByText(/Add tags item/)).toBeInTheDocument();
      expect(
        screen.getAllByRole("button").filter((btn) => btn.querySelector("svg")),
      ).toHaveLength(2); // Remove buttons
    });

    it("renders object fields as JSON textarea", () => {
      const action = createMockAction({
        inputSchema: z.object({
          config: z.object({
            nested: z.string(),
          }),
        }),
      });

      const configValue = { nested: "value" };
      renderComponent({ action, value: { config: configValue } });

      const textarea = screen.getByPlaceholderText(/Enter config as JSON/);
      expect(textarea).toHaveValue(JSON.stringify(configValue, null, 2));
      expect(screen.getByText("Object")).toBeInTheDocument(); // Badge
    });
  });

  describe("User Interactions", () => {
    it("handles string field changes", async () => {
      const onChange = jest.fn();
      renderComponent({ onChange, value: { message: "", count: 0 } });

      const messageInput = screen.getByLabelText(/message/i);
      await user.type(messageInput, "Hello World");

      await waitFor(() => {
        expect(onChange).toHaveBeenLastCalledWith({
          message: "Hello World",
          count: 0,
        });
      });
    });

    it("handles number field changes", async () => {
      const onChange = jest.fn();
      renderComponent({ onChange, value: { message: "", count: 0 } });

      const countInput = screen.getByLabelText(/count/i);
      await user.clear(countInput);
      await user.type(countInput, "42");

      await waitFor(() => {
        expect(onChange).toHaveBeenLastCalledWith({
          message: "",
          count: 42,
        });
      });
    });

    it("handles boolean field changes", async () => {
      const onChange = jest.fn();
      const action = createMockAction({
        inputSchema: z.object({
          enabled: z.boolean(),
        }),
      });

      renderComponent({ action, onChange, value: { enabled: false } });

      const switchElement = screen.getByRole("switch");
      await user.click(switchElement);

      expect(onChange).toHaveBeenCalledWith({ enabled: true });
    });

    it("handles enum field changes", async () => {
      const onChange = jest.fn();
      const action = createMockAction({
        inputSchema: z.object({
          priority: z.enum(["low", "medium", "high"]),
        }),
      });

      renderComponent({ action, onChange, value: { priority: "low" } });

      const selectTrigger = screen.getByRole("combobox");
      await user.click(selectTrigger);

      const highOption = screen.getByText("high");
      await user.click(highOption);

      expect(onChange).toHaveBeenCalledWith({ priority: "high" });
    });

    it("handles array item addition", async () => {
      const onChange = jest.fn();
      const action = createMockAction({
        inputSchema: z.object({
          tags: z.array(z.string()),
        }),
      });

      renderComponent({ action, onChange, value: { tags: ["tag1"] } });

      const addButton = screen.getByText(/Add tags item/);
      await user.click(addButton);

      expect(onChange).toHaveBeenCalledWith({ tags: ["tag1", ""] });
    });

    it("handles array item removal", async () => {
      const onChange = jest.fn();
      const action = createMockAction({
        inputSchema: z.object({
          tags: z.array(z.string()),
        }),
      });

      renderComponent({ action, onChange, value: { tags: ["tag1", "tag2"] } });

      const removeButtons = screen
        .getAllByRole("button")
        .filter((btn) => btn.querySelector("svg"));
      await user.click(removeButtons[0]); // Remove first item

      expect(onChange).toHaveBeenCalledWith({ tags: ["tag2"] });
    });

    it("handles array item changes", async () => {
      const onChange = jest.fn();
      const action = createMockAction({
        inputSchema: z.object({
          tags: z.array(z.string()),
        }),
      });

      renderComponent({ action, onChange, value: { tags: ["tag1", "tag2"] } });

      const firstInput = screen.getByDisplayValue("tag1");
      await user.clear(firstInput);
      await user.type(firstInput, "updated-tag");

      await waitFor(() => {
        expect(onChange).toHaveBeenLastCalledWith({
          tags: ["updated-tag", "tag2"],
        });
      });
    });

    it("handles JSON object editing", async () => {
      const onChange = jest.fn();
      const action = createMockAction({
        inputSchema: z.object({
          config: z.object({ key: z.string() }),
        }),
      });

      renderComponent({
        action,
        onChange,
        value: { config: { key: "value" } },
      });

      const textarea = screen.getByPlaceholderText(/Enter config as JSON/);
      await user.clear(textarea);
      await user.type(textarea, '{"key":"updated"}');

      await waitFor(() => {
        expect(onChange).toHaveBeenLastCalledWith({
          config: { key: "updated" },
        });
      });
    });

    it("handles invalid JSON gracefully", async () => {
      const onChange = jest.fn();
      const action = createMockAction({
        inputSchema: z.object({
          config: z.object({ key: z.string() }),
        }),
      });

      renderComponent({ action, onChange, value: { config: {} } });

      const textarea = screen.getByPlaceholderText(/Enter config as JSON/);
      await user.type(textarea, "invalid json");

      // Should store as string when JSON parsing fails
      expect(onChange).toHaveBeenLastCalledWith({ config: "invalid json" });
    });
  });

  describe("Validation", () => {
    it("shows validation errors for invalid values", async () => {
      const action = createMockAction({
        inputSchema: z.object({
          email: z.string().email(),
          count: z.number().min(10),
        }),
      });

      renderComponent({
        action,
        value: {
          email: "invalid-email",
          count: 5,
        },
      });

      await waitFor(() => {
        expect(screen.getByText(/Invalid email/)).toBeInTheDocument();
        expect(
          screen.getByText(/Number must be greater than or equal to 10/),
        ).toBeInTheDocument();
      });
    });

    it("clears validation errors when values are corrected", async () => {
      const onChange = jest.fn();
      const action = createMockAction({
        inputSchema: z.object({
          email: z.string().email(),
        }),
      });

      const { rerender } = renderComponent({
        action,
        onChange,
        value: { email: "invalid" },
      });

      // Should show error
      await waitFor(() => {
        expect(screen.getByText(/Invalid email/)).toBeInTheDocument();
      });

      // Update with valid email
      rerender(
        <ActionParameterForm
          action={action}
          value={{ email: "valid@email.com" }}
          onChange={onChange}
        />,
      );

      // Error should be gone
      await waitFor(() => {
        expect(screen.queryByText(/Invalid email/)).not.toBeInTheDocument();
      });
    });

    it("shows validation status alert when errors exist", async () => {
      const action = createMockAction({
        inputSchema: z.object({
          required: z.string().min(1),
        }),
      });

      renderComponent({ action, value: { required: "" } });

      await waitFor(() => {
        expect(
          screen.getByText(/Please fix the validation errors above/),
        ).toBeInTheDocument();
      });
    });

    it("highlights fields with errors", async () => {
      const action = createMockAction({
        inputSchema: z.object({
          email: z.string().email(),
        }),
      });

      renderComponent({ action, value: { email: "invalid" } });

      await waitFor(() => {
        const emailInput = screen.getByLabelText(/email/i);
        expect(emailInput).toHaveClass("border-red-500");
      });
    });
  });

  describe("Examples", () => {
    it("renders action examples", () => {
      const action = createMockAction({
        examples: [
          {
            name: "Example 1",
            description: "First example",
            input: { message: "hello", count: 10 },
            output: { result: "success" },
          },
          {
            name: "Example 2",
            description: "Second example",
            input: { message: "world", count: 20 },
            output: { result: "success" },
          },
        ],
      });

      renderComponent({ action });

      expect(screen.getByText("Examples")).toBeInTheDocument();
      expect(screen.getByText("Example 1")).toBeInTheDocument();
      expect(screen.getByText("First example")).toBeInTheDocument();
      expect(screen.getByText("Example 2")).toBeInTheDocument();
      expect(screen.getByText("Second example")).toBeInTheDocument();
    });

    it("applies example when button clicked", async () => {
      const onChange = jest.fn();
      const exampleInput = { message: "hello", count: 10 };
      const action = createMockAction({
        examples: [
          {
            name: "Example 1",
            description: "First example",
            input: exampleInput,
            output: { result: "success" },
          },
        ],
      });

      renderComponent({ action, onChange, value: {} });

      const useExampleButton = screen.getByText("Use Example");
      await user.click(useExampleButton);

      expect(onChange).toHaveBeenCalledWith(exampleInput);
    });

    it("does not render examples section when no examples", () => {
      const action = createMockAction({
        examples: undefined,
      });

      renderComponent({ action });

      expect(screen.queryByText("Examples")).not.toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("handles deeply nested schemas", () => {
      const action = createMockAction({
        inputSchema: z.object({
          level1: z.object({
            level2: z.object({
              level3: z.string(),
            }),
          }),
        }),
      });

      renderComponent({
        action,
        value: { level1: { level2: { level3: "deep" } } },
      });

      // Should render as JSON textarea for complex objects
      const textarea = screen.getByPlaceholderText(/Enter level1 as JSON/);
      expect(textarea).toHaveValue(
        JSON.stringify({ level2: { level3: "deep" } }, null, 2),
      );
    });

    it("handles optional fields correctly", () => {
      const action = createMockAction({
        inputSchema: z.object({
          optional: z.string().optional(),
          required: z.string(),
        }),
      });

      renderComponent({ action, value: { required: "value" } });

      // Should not show validation error for optional field
      expect(screen.queryByText(/optional.*required/i)).not.toBeInTheDocument();
    });

    it("handles union types as generic fields", () => {
      const action = createMockAction({
        inputSchema: z.object({
          unionField: z.union([z.string(), z.number()]),
        }),
      });

      renderComponent({ action, value: { unionField: "string or number" } });

      // Should render as textarea for unknown types
      const textarea = screen.getByPlaceholderText(/Enter unionField as JSON/);
      expect(textarea).toBeInTheDocument();
    });

    it("handles nullable fields", () => {
      const action = createMockAction({
        inputSchema: z.object({
          nullable: z.string().nullable(),
        }),
      });

      renderComponent({ action, value: { nullable: null } });

      const input = screen.getByLabelText(/nullable/i);
      expect(input).toHaveValue("");
    });

    it("handles fields with default values", async () => {
      const onChange = jest.fn();
      const action = createMockAction({
        inputSchema: z.object({
          withDefault: z.string().default("default value"),
        }),
      });

      renderComponent({ action, onChange, value: {} });

      // The form should display empty, not the default
      // (defaults are typically applied during execution, not in the form)
      const input = screen.getByLabelText(/withDefault/i);
      expect(input).toHaveValue("");
    });
  });

  describe("Performance", () => {
    it("only validates when values change", async () => {
      const validateSpy = jest.fn();
      const action = createMockAction({
        inputSchema: z.object({
          field: z.string().refine((val) => {
            validateSpy();
            return val.length > 0;
          }),
        }),
      });

      const { rerender } = renderComponent({
        action,
        value: { field: "test" },
      });

      // Initial validation
      await waitFor(() => {
        expect(validateSpy).toHaveBeenCalledTimes(1);
      });

      // Re-render with same value
      rerender(
        <ActionParameterForm
          action={action}
          value={{ field: "test" }}
          onChange={jest.fn()}
        />,
      );

      // Should not re-validate
      expect(validateSpy).toHaveBeenCalledTimes(1);

      // Re-render with different value
      rerender(
        <ActionParameterForm
          action={action}
          value={{ field: "different" }}
          onChange={jest.fn()}
        />,
      );

      // Should validate again
      await waitFor(() => {
        expect(validateSpy).toHaveBeenCalledTimes(2);
      });
    });
  });
});
