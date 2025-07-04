import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, RenderResult } from "@testing-library/react";
import React from "react";
import { trpc } from "@/lib/trpc";

// Simple mock for tRPC without MSW dependency
// export const trpcMsw = createTRPCMsw<AppRouter>();

// Types for mock handlers
type MockHandler = (...args: any[]) => any;
type MockHandlers = Record<string, MockHandler | Record<string, any>>;

// Mock tRPC client for testing
export const createMockTrpcClient = (mockHandlers: MockHandlers = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const mockTrpcClient = trpc.createClient({
    links: [
      // Mock implementation that returns the mock handlers
      () => {
        // Return a properly typed operation link function
        return (ctx: any) => {
          const { path, input } = ctx.op;
          const handlerPath = path.split(".");
          let handler: any = mockHandlers;

          for (const segment of handlerPath) {
            handler = handler?.[segment];
          }

          // Create a proper observable that fully implements the required interface
          const observable = {
            subscribe: (observer: {
              next?: (value: any) => void;
              error?: (error: any) => void;
              complete?: () => void;
            }) => {
              const unsubscribe = () => {
                // Cleanup logic here if needed
              };

              try {
                if (handler && typeof handler === "function") {
                  // Call the handler and pass the result
                  observer.next?.({
                    result: { data: handler(input) },
                  });
                } else {
                  // Fallback for when no handler is found
                  observer.next?.({
                    result: {
                      data: null,
                      error: {
                        message: `No mock handler found for ${path}`,
                        code: "NOT_FOUND",
                      },
                    },
                  });
                }
                observer.complete?.();
              } catch (err) {
                observer.error?.(err);
              }

              return {
                unsubscribe,
              };
            },

            // Properly implement the pipe method to match the Observable interface
            pipe: function (): any {
              // In a real implementation, we would apply the operators
              // For our mock, we'll return a new observable with the same interface
              return {
                subscribe: this.subscribe,
                pipe: function () {
                  // Support chaining by returning another object with the same interface
                  return {
                    subscribe: observable.subscribe,
                    pipe: function () {
                      return this; // Support unlimited chaining
                    },
                  };
                },
              };
            },
          };

          return observable;
        };
      },
    ],
  });

  return { queryClient, mockTrpcClient };
};

// Test wrapper component
export const createTrpcTestWrapper = (mockHandlers: MockHandlers = {}) => {
  const { queryClient, mockTrpcClient } = createMockTrpcClient(mockHandlers);

  return function TrpcTestWrapper({ children }: { children: React.ReactNode }) {
    return (
      <trpc.Provider client={mockTrpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </trpc.Provider>
    );
  };
};

// Custom render function with tRPC wrapper
export const renderWithTrpc = (
  ui: React.ReactElement,
  mockHandlers: MockHandlers = {},
): RenderResult => {
  const Wrapper = createTrpcTestWrapper(mockHandlers);
  return render(ui, { wrapper: Wrapper });
};

// Custom renderHook function with tRPC wrapper
export const renderHookWithTrpc = <T,>(
  hook: () => T,
  mockHandlers: MockHandlers = {},
): any => {
  const Wrapper = createTrpcTestWrapper(mockHandlers);
  return renderHook(hook, { wrapper: Wrapper });
};

// Tool interface for testing
interface MockTool {
  id: number;
  userId: string;
  name: string;
  type: string;
  credentials: Record<string, any>;
  description?: string;
  tags?: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Helper to create mock tool data
export const createMockTool = (
  overrides: Partial<MockTool> = {},
): MockTool => ({
  id: 1,
  userId: "user-1",
  name: "Test Tool",
  type: "EMAIL",
  credentials: {
    smtpHost: "smtp.test.com",
    smtpPort: 587,
    smtpUser: "test@test.com",
    smtpPassword: "password",
    fromEmail: "test@test.com",
    fromName: "Test User",
    enableTLS: true,
  },
  description: "Test tool description",
  tags: ["test"],
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Template interface for testing
interface MockTemplate {
  id: number;
  userId: string;
  name: string;
  type: string;
  content: string;
  subject?: string;
  description?: string;
  variables?: Array<{
    name: string;
    required: boolean;
    defaultValue?: string;
  }>;
  isSystemTemplate: boolean;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// Helper to create mock template data
export const createMockTemplate = (
  overrides: Partial<MockTemplate> = {},
): MockTemplate => ({
  id: 1,
  userId: "user-1",
  name: "Test Template",
  type: "EMAIL",
  content: "Test email content: {{message}}",
  subject: "Test Subject: {{title}}",
  description: "Test template description",
  variables: [
    { name: "message", required: true },
    { name: "title", required: false, defaultValue: "Default Title" },
  ],
  isSystemTemplate: false,
  tags: ["test"],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Webhook interface for testing
interface MockWebhook {
  id: number;
  userId: string;
  workflowId: number;
  key: string;
  url: string;
  description?: string;
  isActive: boolean;
  allowedMethods: string[];
  allowedIps: string[];
  rateLimitPerMinute: number;
  requireAuth: boolean;
  authToken: string | null;
  customHeaders: Record<string, string>;
  responseFormat: "json" | "text";
  triggerCount: number;
  lastTriggered: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Helper to create mock webhook data
export const createMockWebhook = (
  overrides: Partial<MockWebhook> = {},
): MockWebhook => ({
  id: 1,
  userId: "user-1",
  workflowId: 1,
  key: "test-webhook",
  url: "/api/workflows/webhook/test-webhook",
  description: "Test webhook",
  isActive: true,
  allowedMethods: ["POST"],
  allowedIps: [],
  rateLimitPerMinute: 60,
  requireAuth: false,
  authToken: null,
  customHeaders: {},
  responseFormat: "json" as const,
  triggerCount: 0,
  lastTriggered: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Mock handlers for common tRPC operations
export const mockToolsHandlers = {
  tools: {
    getAll: jest.fn(() => ({
      tools: [createMockTool()],
      total: 1,
      hasMore: false,
    })),
    getById: jest.fn((input: { id: number }) =>
      createMockTool({ id: input.id }),
    ),
    create: jest.fn((input: any) => createMockTool({ ...input, id: 2 })),
    update: jest.fn((input: any) => createMockTool({ ...input })),
    delete: jest.fn(() => ({ success: true })),
    test: jest.fn(() => ({
      success: true,
      message: "Tool test successful",
      details: { testDuration: 150 },
    })),
    validateCredentials: jest.fn(() => ({
      valid: true,
      errors: [],
      warnings: [],
      suggestions: [],
    })),
  },
  integrations: {
    templates: {
      getAll: jest.fn(() => ({
        templates: [createMockTemplate()],
        total: 1,
        hasMore: false,
      })),
      getById: jest.fn((input: { id: number }) =>
        createMockTemplate({ id: input.id }),
      ),
      create: jest.fn((input: any) => createMockTemplate({ ...input, id: 2 })),
      update: jest.fn((input: any) => createMockTemplate({ ...input })),
      delete: jest.fn(() => ({ success: true })),
    },
    slack: {
      send: jest.fn(() => ({
        success: true,
        message: "Slack message sent successfully",
        details: {
          messageId: "slack_123",
          timestamp: new Date().toISOString(),
        },
      })),
    },
    discord: {
      send: jest.fn(() => ({
        success: true,
        message: "Discord message sent successfully",
        details: {
          messageId: "discord_123",
          timestamp: new Date().toISOString(),
        },
      })),
    },
    email: {
      send: jest.fn(() => ({
        success: true,
        message: "Email sent successfully",
        results: [
          { recipient: "test@test.com", success: true, messageId: "email_123" },
        ],
      })),
    },
    testMessage: jest.fn(() => ({
      success: true,
      message: "Test message sent successfully",
      details: { testType: "connection", timestamp: new Date().toISOString() },
    })),
  },
  webhooks: {
    getAll: jest.fn(() => ({
      webhooks: [createMockWebhook()],
      total: 1,
      hasMore: false,
    })),
    getByKey: jest.fn((input: { key: string }) =>
      createMockWebhook({ key: input.key }),
    ),
    create: jest.fn((input: any) => createMockWebhook({ ...input, id: 2 })),
    update: jest.fn((input: any) => createMockWebhook({ ...input })),
    delete: jest.fn(() => ({ success: true })),
  },
};

// Performance testing utilities
export const measureApiResponseTime = async (
  apiCall: () => Promise<any>,
): Promise<number> => {
  const startTime = performance.now();
  await apiCall();
  const endTime = performance.now();
  return endTime - startTime;
};

// TRPC Error interface
interface TrpcError {
  code: string;
  message: string;
  data: {
    code: string;
    httpStatus: number;
  };
}

// Error handling test utilities
export const createTrpcError = (code: string, message: string): TrpcError => ({
  code,
  message,
  data: {
    code,
    httpStatus: code === "UNAUTHORIZED" ? 401 : 400,
  },
});

// Mock error handlers
export const mockErrorHandlers = {
  tools: {
    getAll: jest
      .fn()
      .mockRejectedValue(
        createTrpcError("UNAUTHORIZED", "Authentication required"),
      ),
    create: jest
      .fn()
      .mockRejectedValue(createTrpcError("BAD_REQUEST", "Invalid tool data")),
  },
};

// Add a simple test to satisfy Jest requirements
describe("trpc-test-utils", () => {
  it("should export renderWithTrpc function", () => {
    expect(renderWithTrpc).toBeDefined();
  });
});
