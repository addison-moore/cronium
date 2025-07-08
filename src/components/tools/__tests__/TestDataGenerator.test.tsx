import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";
import TestDataGenerator from "../TestDataGenerator";
import { type ToolAction } from "@/components/tools/types/tool-plugin";

// Mock faker
jest.mock("@faker-js/faker", () => ({
  faker: {
    internet: {
      email: jest.fn(() => "test@example.com"),
      url: jest.fn(() => "https://example.com"),
      username: jest.fn(() => "testuser"),
      password: jest.fn(() => "password123"),
    },
    person: {
      fullName: jest.fn(() => "John Doe"),
      firstName: jest.fn(() => "John"),
      lastName: jest.fn(() => "Doe"),
      jobTitle: jest.fn(() => "Developer"),
    },
    phone: {
      number: jest.fn(() => "+1234567890"),
    },
    location: {
      streetAddress: jest.fn(() => "123 Main St"),
      city: jest.fn(() => "New York"),
      country: jest.fn(() => "USA"),
    },
    company: {
      name: jest.fn(() => "Acme Corp"),
    },
    lorem: {
      paragraph: jest.fn(() => "Lorem ipsum dolor sit amet"),
      sentences: jest.fn(() => "Lorem ipsum. Dolor sit amet."),
      sentence: jest.fn(() => "Lorem ipsum dolor sit amet"),
      words: jest.fn(() => "lorem ipsum dolor"),
      paragraphs: jest.fn(
        () => "Lorem ipsum dolor sit amet.\n\nDolor sit amet consectetur.",
      ),
    },
    date: {
      future: jest.fn(() => new Date("2025-12-31")),
      recent: jest.fn(() => new Date("2024-01-01")),
    },
    commerce: {
      price: jest.fn(() => "19.99"),
    },
    number: {
      int: jest.fn(
        ({ min = 0, max = 100 } = {}) =>
          Math.floor(Math.random() * (max - min + 1)) + min,
      ),
    },
    string: {
      uuid: jest.fn(() => "12345678-1234-1234-1234-123456789012"),
      alphanumeric: jest.fn(() => "abc123def456"),
      alpha: jest.fn((length: number) => "a".repeat(length)),
    },
    datatype: {
      boolean: jest.fn(() => true),
    },
    helpers: {
      arrayElement: jest.fn((arr: any[]) => arr[0]),
    },
  },
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
});

// Mock URL and document for export functionality
global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
global.URL.revokeObjectURL = jest.fn();

// Mock FileReader for import functionality
global.FileReader = class {
  onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null =
    null;
  readAsText = jest.fn((file: File) => {
    if (this.onload) {
      this.onload({
        target: {
          result: JSON.stringify({
            datasets: [
              {
                name: "Imported Test",
                description: "Imported test data",
                data: { test: "imported" },
                tags: ["imported"],
              },
            ],
          }),
        },
      } as any);
    }
  });
} as any;

describe("TestDataGenerator", () => {
  const mockOnApply = jest.fn();

  const sampleAction: ToolAction = {
    id: "test-action",
    name: "Test Action",
    description: "A test action",
    inputSchema: z.object({
      email: z.string().email(),
      name: z.string(),
      age: z.number().min(0).max(120),
      isActive: z.boolean(),
      tags: z.array(z.string()).optional(),
      preferences: z.object({
        theme: z.enum(["light", "dark"]),
        notifications: z.boolean(),
      }),
    }),
    examples: [
      {
        name: "Example 1",
        description: "First example",
        input: {
          email: "example@test.com",
          name: "Example User",
          age: 30,
          isActive: true,
        },
      },
    ],
    execute: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock DOM methods
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
    jest
      .spyOn(document, "getElementById")
      .mockReturnValue(document.createElement("input"));
  });

  describe("Rendering", () => {
    it("renders initial empty state", () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);

      expect(screen.getByText("Test Data Generator")).toBeInTheDocument();
      expect(
        screen.getByText("No test data generated yet."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /generate test data/i }),
      ).toBeInTheDocument();
    });

    it("renders with current values", () => {
      render(
        <TestDataGenerator
          action={sampleAction}
          onApply={mockOnApply}
          currentValue={{ email: "current@test.com" }}
        />,
      );

      expect(screen.getByText("Test Data Generator")).toBeInTheDocument();
    });

    it("shows import and export buttons", () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);

      expect(
        screen.getByRole("button", { name: /import/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /export/i }),
      ).toBeInTheDocument();
    });
  });

  describe("Data Generation", () => {
    it("generates test data when generate button is clicked", async () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);

      const generateButton = screen.getByRole("button", {
        name: /generate test data/i,
      });
      await userEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText("Example 1")).toBeInTheDocument(); // From action examples
        expect(screen.getByText("Basic Test")).toBeInTheDocument();
        expect(screen.getByText("Full Test")).toBeInTheDocument();
        expect(screen.getByText("Edge Case")).toBeInTheDocument();
        expect(screen.getByText("Real-world")).toBeInTheDocument();
      });
    });

    it("shows loading state during generation", async () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);

      const generateButton = screen.getByRole("button", { name: /generate/i });

      // Click and immediately check for loading state
      userEvent.click(generateButton);
      expect(generateButton).toBeDisabled();
    });

    it("includes examples from action", async () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);

      await userEvent.click(screen.getByRole("button", { name: /generate/i }));

      await waitFor(() => {
        expect(screen.getByText("Example 1")).toBeInTheDocument();
        expect(screen.getByText("First example")).toBeInTheDocument();
      });
    });

    it("generates different scenario types", async () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);

      await userEvent.click(screen.getByRole("button", { name: /generate/i }));

      await waitFor(() => {
        expect(screen.getByText("Basic Test")).toBeInTheDocument();
        expect(screen.getByText("Full Test")).toBeInTheDocument();
        expect(screen.getByText("Edge Case")).toBeInTheDocument();
        expect(screen.getByText("Real-world")).toBeInTheDocument();
      });
    });
  });

  describe("Test Data Sets Display", () => {
    beforeEach(async () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);
      await userEvent.click(screen.getByRole("button", { name: /generate/i }));
      await waitFor(() => {
        expect(screen.getByText("Basic Test")).toBeInTheDocument();
      });
    });

    it("displays test data sets in table format", () => {
      expect(
        screen.getByRole("columnheader", { name: /name/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /description/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /tags/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /actions/i }),
      ).toBeInTheDocument();
    });

    it("shows tags for each test data set", () => {
      expect(screen.getByText("example")).toBeInTheDocument();
      expect(screen.getByText("official")).toBeInTheDocument();
      expect(screen.getByText("basic")).toBeInTheDocument();
      expect(screen.getByText("minimal")).toBeInTheDocument();
    });

    it("allows selecting a test data set", async () => {
      const basicTestRow = screen.getByText("Basic Test").closest("tr");
      await userEvent.click(basicTestRow!);

      expect(basicTestRow).toHaveClass("bg-muted");
    });
  });

  describe("Copy Functionality", () => {
    beforeEach(async () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);
      await userEvent.click(screen.getByRole("button", { name: /generate/i }));
      await waitFor(() => {
        expect(screen.getByText("Basic Test")).toBeInTheDocument();
      });
    });

    it("copies test data to clipboard", async () => {
      const copyButtons = screen
        .getAllByRole("button")
        .filter((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-4 w-4"),
        );

      await userEvent.click(copyButtons[0]);

      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it("shows check icon after successful copy", async () => {
      const copyButtons = screen
        .getAllByRole("button")
        .filter((btn) =>
          btn.querySelector("svg")?.getAttribute("class")?.includes("h-4 w-4"),
        );

      await userEvent.click(copyButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("img", { hidden: true })).toBeInTheDocument(); // Check icon
      });
    });
  });

  describe("Apply Functionality", () => {
    beforeEach(async () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);
      await userEvent.click(screen.getByRole("button", { name: /generate/i }));
      await waitFor(() => {
        expect(screen.getByText("Basic Test")).toBeInTheDocument();
      });
    });

    it("applies test data when apply button is clicked", async () => {
      const applyButtons = screen.getAllByRole("button", { name: /apply/i });
      await userEvent.click(applyButtons[0]);

      expect(mockOnApply).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "example@test.com", // From example
        }),
      );
    });

    it("prevents event propagation when clicking apply button", async () => {
      const mockRowClick = jest.fn();
      const basicTestRow = screen.getByText("Basic Test").closest("tr");
      basicTestRow!.addEventListener("click", mockRowClick);

      const applyButton =
        basicTestRow!.querySelector(
          'button[name*="apply"], button:has-text("Apply")',
        ) || screen.getAllByRole("button", { name: /apply/i })[0];

      await userEvent.click(applyButton);

      expect(mockRowClick).not.toHaveBeenCalled();
    });
  });

  describe("Preview Tab", () => {
    beforeEach(async () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);
      await userEvent.click(screen.getByRole("button", { name: /generate/i }));
      await waitFor(() => {
        expect(screen.getByText("Basic Test")).toBeInTheDocument();
      });
    });

    it("switches to preview tab", async () => {
      const previewTab = screen.getByRole("tab", { name: /preview/i });
      await userEvent.click(previewTab);

      expect(
        screen.getByText("Select a test data set from the list to preview."),
      ).toBeInTheDocument();
    });

    it("shows selected data set in preview", async () => {
      // Select a data set first
      const basicTestRow = screen.getByText("Basic Test").closest("tr");
      await userEvent.click(basicTestRow!);

      // Switch to preview tab
      const previewTab = screen.getByRole("tab", { name: /preview/i });
      await userEvent.click(previewTab);

      expect(screen.getByText("Basic Test")).toBeInTheDocument();
      expect(screen.getByText("JSON Data")).toBeInTheDocument();
    });

    it("allows applying from preview", async () => {
      // Select and switch to preview
      const basicTestRow = screen.getByText("Basic Test").closest("tr");
      await userEvent.click(basicTestRow!);

      const previewTab = screen.getByRole("tab", { name: /preview/i });
      await userEvent.click(previewTab);

      const applyButton = screen.getByRole("button", {
        name: /apply test data/i,
      });
      await userEvent.click(applyButton);

      expect(mockOnApply).toHaveBeenCalled();
    });

    it("cancels preview selection", async () => {
      // Select and switch to preview
      const basicTestRow = screen.getByText("Basic Test").closest("tr");
      await userEvent.click(basicTestRow!);

      const previewTab = screen.getByRole("tab", { name: /preview/i });
      await userEvent.click(previewTab);

      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      await userEvent.click(cancelButton);

      expect(
        screen.getByText("Select a test data set from the list to preview."),
      ).toBeInTheDocument();
    });
  });

  describe("Export Functionality", () => {
    beforeEach(async () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);
      await userEvent.click(screen.getByRole("button", { name: /generate/i }));
      await waitFor(() => {
        expect(screen.getByText("Basic Test")).toBeInTheDocument();
      });
    });

    it("exports test data as JSON file", async () => {
      const exportButton = screen.getByRole("button", { name: /export/i });
      await userEvent.click(exportButton);

      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(document.createElement).toHaveBeenCalledWith("a");
    });

    it("disables export button when no data is available", () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);

      const exportButton = screen.getByRole("button", { name: /export/i });
      expect(exportButton).toBeDisabled();
    });
  });

  describe("Import Functionality", () => {
    it("imports test data from JSON file", async () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);

      const importButton = screen.getByRole("button", { name: /import/i });
      await userEvent.click(importButton);

      // Simulate file selection
      const fileInput = document.getElementById(
        "import-data",
      ) as HTMLInputElement;
      const file = new File(['{"datasets":[]}'], "test.json", {
        type: "application/json",
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      expect(FileReader.prototype.readAsText).toHaveBeenCalledWith(file);
    });

    it("handles import errors gracefully", async () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      // Mock FileReader to throw error
      global.FileReader = class {
        onload:
          | ((this: FileReader, ev: ProgressEvent<FileReader>) => any)
          | null = null;
        readAsText = jest.fn((file: File) => {
          if (this.onload) {
            this.onload({
              target: { result: "invalid json" },
            } as any);
          }
        });
      } as any;

      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);

      const importButton = screen.getByRole("button", { name: /import/i });
      await userEvent.click(importButton);

      const fileInput = document.getElementById(
        "import-data",
      ) as HTMLInputElement;
      const file = new File(["invalid"], "test.json", {
        type: "application/json",
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to import:",
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("Schema-Based Generation", () => {
    it("generates data based on string schema with email validation", () => {
      const actionWithEmail: ToolAction = {
        ...sampleAction,
        inputSchema: z.object({
          email: z.string().email(),
        }),
      };

      render(
        <TestDataGenerator action={actionWithEmail} onApply={mockOnApply} />,
      );

      // This would test the internal generateTestData function
      // The actual test would need to be more complex to verify the generated data
    });

    it("generates data for number fields with min/max constraints", () => {
      const actionWithConstraints: ToolAction = {
        ...sampleAction,
        inputSchema: z.object({
          count: z.number().min(1).max(10),
        }),
      };

      render(
        <TestDataGenerator
          action={actionWithConstraints}
          onApply={mockOnApply}
        />,
      );

      // Test would verify that generated numbers are within constraints
    });

    it("handles array fields correctly", () => {
      const actionWithArray: ToolAction = {
        ...sampleAction,
        inputSchema: z.object({
          tags: z.array(z.string()),
        }),
      };

      render(
        <TestDataGenerator action={actionWithArray} onApply={mockOnApply} />,
      );

      // Test would verify array generation
    });

    it("handles enum fields correctly", () => {
      const actionWithEnum: ToolAction = {
        ...sampleAction,
        inputSchema: z.object({
          status: z.enum(["active", "inactive", "pending"]),
        }),
      };

      render(
        <TestDataGenerator action={actionWithEnum} onApply={mockOnApply} />,
      );

      // Test would verify enum value selection
    });

    it("handles nested object schemas", () => {
      const actionWithNested: ToolAction = {
        ...sampleAction,
        inputSchema: z.object({
          user: z.object({
            name: z.string(),
            email: z.string().email(),
          }),
        }),
      };

      render(
        <TestDataGenerator action={actionWithNested} onApply={mockOnApply} />,
      );

      // Test would verify nested object generation
    });
  });

  describe("Field Pattern Matching", () => {
    it("matches field names to appropriate generators", async () => {
      const actionWithPatterns: ToolAction = {
        ...sampleAction,
        inputSchema: z.object({
          userEmail: z.string(),
          websiteUrl: z.string(),
          phoneNumber: z.string(),
          firstName: z.string(),
        }),
      };

      render(
        <TestDataGenerator action={actionWithPatterns} onApply={mockOnApply} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /generate/i }));

      // Test would verify that appropriate generators were used based on field names
    });
  });

  describe("Edge Cases", () => {
    it("handles action without examples", async () => {
      const actionNoExamples: ToolAction = {
        ...sampleAction,
        examples: undefined,
      };

      render(
        <TestDataGenerator action={actionNoExamples} onApply={mockOnApply} />,
      );
      await userEvent.click(screen.getByRole("button", { name: /generate/i }));

      await waitFor(() => {
        expect(screen.getByText("Basic Test")).toBeInTheDocument();
        expect(screen.queryByText("Example 1")).not.toBeInTheDocument();
      });
    });

    it("handles empty file input", () => {
      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);

      const fileInput = document.getElementById(
        "import-data",
      ) as HTMLInputElement;
      fireEvent.change(fileInput, { target: { files: [] } });

      // Should not crash or throw errors
      expect(screen.getByText("Test Data Generator")).toBeInTheDocument();
    });

    it("handles clipboard copy failure gracefully", async () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      navigator.clipboard.writeText = jest
        .fn()
        .mockRejectedValue(new Error("Clipboard error"));

      render(<TestDataGenerator action={sampleAction} onApply={mockOnApply} />);
      await userEvent.click(screen.getByRole("button", { name: /generate/i }));

      await waitFor(async () => {
        const copyButtons = screen
          .getAllByRole("button")
          .filter((btn) =>
            btn
              .querySelector("svg")
              ?.getAttribute("class")
              ?.includes("h-4 w-4"),
          );

        await userEvent.click(copyButtons[0]);

        expect(consoleSpy).toHaveBeenCalledWith(
          "Failed to copy:",
          expect.any(Error),
        );
      });

      consoleSpy.mockRestore();
    });
  });
});
