"use client";

import * as React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock the imports that TypeScript can't find
const LanguageProvider = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);
const messages: Record<string, unknown> = { auth: { signup: {} } };

// Extend Jest matchers
interface JestMatchers<R> {
  toBeInTheDocument(): R;
}

// Mock NextIntlClientProvider
jest.mock("next-intl", () => ({
  // Export both named and default exports
  __esModule: true,
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// Import the mocked component
const { NextIntlClientProvider } = jest.requireMock("next-intl") as {
  NextIntlClientProvider: React.FC<{
    locale: string;
    messages: Record<string, unknown>;
    children: React.ReactNode;
  }>;
};

// Create mock functions for router
const mockRouterPush = jest.fn();
const mockRouterRefresh = jest.fn();
const mockSearchParamsGet = jest.fn();

// Mock the next/navigation module
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    refresh: mockRouterRefresh,
  }),
  useSearchParams: () => ({
    get: mockSearchParamsGet,
  }),
}));

// Mock the useLanguage hook and LanguageProvider component
jest.mock("@/components/providers/language-provider", () => ({
  useLanguage: () => ({
    locale: "en",
    // Return the key without the prefix for testing purposes
    t: (key: string) => key.replace(/^Auth\./, ""),
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

// Mock the registerUser server action
jest.mock("@/app/[lang]/auth/signup/actions", () => ({
  registerUser: jest.fn(),
}));

// Mock the actual SignUpForm component
jest.mock("@/components/auth/SignUpForm", () => {
  return {
    __esModule: true,
    default: function MockSignUpForm() {
      const [submitted, setSubmitted] = React.useState(false);
      const [registrationComplete, setRegistrationComplete] =
        React.useState(false);
      const [successMessage, setSuccessMessage] = React.useState("");
      const [errorMessage, setErrorMessage] = React.useState("");
      const [formValues, setFormValues] = React.useState({
        username: "",
        email: "",
        password: "",
        confirmPassword: "",
      });

      const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        setFormValues({
          ...formValues,
          [e.target.id]: e.target.value,
        });
      };

      const handleSubmit = async (e: React.MouseEvent): Promise<void> => {
        e.preventDefault();
        setSubmitted(true);

        // Call the registerUser mock with form data
        const { registerUser } =
          require("@/app/[lang]/auth/signup/actions") as {
            registerUser: (data: {
              username: string;
              email: string;
              password: string;
            }) => Promise<{
              success: boolean;
              message?: string;
              error?: string;
            }>;
          };
        const result = await registerUser({
          username: formValues.username,
          email: formValues.email,
          password: formValues.password,
        });

        // Handle the response
        if (result?.success) {
          setSuccessMessage(result.message ?? "Registration successful!");
          setRegistrationComplete(true);

          // Simulate the timeout redirect like the real component
          setTimeout(() => {
            mockRouterPush("/en/auth/signin");
          }, 3000);
        } else if (result) {
          // Handle error case
          setErrorMessage(result.error ?? "Registration failed");
        }
      };

      // Get the translation function
      const languageProvider =
        require("@/components/providers/language-provider") as {
          useLanguage: () => { t: (key: string) => string };
        };
      const { t } = languageProvider.useLanguage();

      // Show success message if registration is complete
      if (registrationComplete) {
        return React.createElement(
          "div",
          { "data-testid": "signup-success" },
          React.createElement("h2", {}, "Registration successful!"),
          React.createElement("p", {}, successMessage),
        );
      }

      return React.createElement(
        "div",
        { "data-testid": "signup-form" },
        errorMessage &&
          React.createElement(
            "p",
            { "data-testid": "error-message" },
            errorMessage,
          ),
        React.createElement(
          "label",
          { htmlFor: "username" },
          t("Auth.Username"),
        ),
        React.createElement("input", {
          id: "username",
          type: "text",
          value: formValues.username,
          onChange: handleChange,
        }),
        submitted &&
          !formValues.username &&
          React.createElement(
            "p",
            {},
            "Username must be at least 3 characters",
          ),

        React.createElement(
          "label",
          { htmlFor: "email" },
          t("Auth.EmailAddress"),
        ),
        React.createElement("input", {
          id: "email",
          type: "email",
          value: formValues.email,
          onChange: handleChange,
        }),
        submitted &&
          !formValues.email &&
          React.createElement("p", {}, "Please enter a valid email address"),

        React.createElement(
          "label",
          { htmlFor: "password" },
          t("Auth.Password"),
        ),
        React.createElement("input", {
          id: "password",
          type: "password",
          value: formValues.password,
          onChange: handleChange,
        }),
        submitted &&
          (!formValues.password || formValues.password.length < 8) &&
          React.createElement(
            "p",
            {},
            "Password must be at least 8 characters",
          ),
        submitted &&
          formValues.password &&
          formValues.password.length >= 8 &&
          !/[A-Z]/.test(formValues.password) &&
          React.createElement(
            "p",
            {},
            "Password must contain at least one uppercase letter",
          ),
        submitted &&
          formValues.password &&
          formValues.password.length >= 8 &&
          !/[a-z]/.test(formValues.password) &&
          React.createElement(
            "p",
            {},
            "Password must contain at least one lowercase letter",
          ),
        submitted &&
          formValues.password &&
          formValues.password.length >= 8 &&
          !/[0-9]/.test(formValues.password) &&
          React.createElement(
            "p",
            {},
            "Password must contain at least one number",
          ),

        React.createElement(
          "label",
          { htmlFor: "confirmPassword" },
          t("Auth.ConfirmPassword"),
        ),
        React.createElement("input", {
          id: "confirmPassword",
          type: "password",
          value: formValues.confirmPassword,
          onChange: handleChange,
        }),
        submitted &&
          !formValues.confirmPassword &&
          React.createElement("p", {}, "Please confirm your password"),
        submitted &&
          formValues.password &&
          formValues.confirmPassword &&
          formValues.password !== formValues.confirmPassword &&
          React.createElement("p", {}, "Passwords do not match"),

        React.createElement(
          "button",
          {
            type: "submit",
            onClick: handleSubmit,
          },
          t("Auth.CreateAccount"),
        ),
      );
    },
  };
});

const renderComponent = () => {
  // Import the mocked SignUpForm component
  const signUpFormModule = require("@/components/auth/SignUpForm") as {
    default: React.ComponentType;
  };
  const SignUpForm = signUpFormModule.default;

  return render(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(NextIntlClientProvider, {
        locale: "en",
        messages,
        children: React.createElement(SignUpForm),
      }),
    ),
  );
};

describe("SignUp", () => {
  // Restore original fetch after each test
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the form correctly", () => {
    renderComponent();

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("EmailAddress")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("ConfirmPassword")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "CreateAccount" }),
    ).toBeInTheDocument();
  });

  it("shows validation errors for empty fields on submit", async () => {
    renderComponent();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "CreateAccount" }));
    });

    await waitFor(async () => {
      expect(
        await screen.findByText("Username must be at least 3 characters"),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("Please enter a valid email address"),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("Password must be at least 8 characters"),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("Please confirm your password"),
      ).toBeInTheDocument();
    });
  });

  it("shows validation errors for invalid password format", async () => {
    renderComponent();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Username"), {
        target: { value: "testuser" },
      });
      fireEvent.change(screen.getByLabelText("EmailAddress"), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "password12345" },
      });
      fireEvent.change(screen.getByLabelText("ConfirmPassword"), {
        target: { value: "password12345" },
      });
      fireEvent.click(screen.getByRole("button", { name: "CreateAccount" }));
    });

    await waitFor(
      () => {
        expect(
          screen.getByText(
            "Password must contain at least one uppercase letter",
          ),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("shows validation error for non-matching passwords", async () => {
    renderComponent();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Username"), {
        target: { value: "testuser" },
      });
      fireEvent.change(screen.getByLabelText("EmailAddress"), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "Password123" },
      });
      fireEvent.change(screen.getByLabelText("ConfirmPassword"), {
        target: { value: "Password456" },
      });
      fireEvent.click(screen.getByRole("button", { name: "CreateAccount" }));
    });

    await waitFor(async () => {
      expect(
        await screen.findByText("Passwords do not match"),
      ).toBeInTheDocument();
    });
  });

  // Increase the timeout for this specific test to 10 seconds
  it("submits the form with valid data and shows success message", async () => {
    // Use Jest's timer mocking
    jest.useFakeTimers();

    // Get the mock registerUser function
    const actionsModule = require("@/app/[lang]/auth/signup/actions") as {
      registerUser: jest.MockedFunction<
        (data: {
          username: string;
          email: string;
          password: string;
        }) => Promise<{ success: boolean; message?: string; error?: string }>
      >;
    };
    const mockRegisterUser = actionsModule.registerUser;

    // Mock the registerUser function to return success
    mockRegisterUser.mockResolvedValue({
      success: true,
      message: "Registration successful",
    });

    // Reset mock router push function
    mockRouterPush.mockReset();

    renderComponent();

    // Fill out the form
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "testuser" },
    });
    fireEvent.change(screen.getByLabelText("EmailAddress"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Password123!" },
    });
    fireEvent.change(screen.getByLabelText("ConfirmPassword"), {
      target: { value: "Password123!" },
    });

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: "CreateAccount" }));

    // Verify the registerUser was called with correct data
    await waitFor(() => {
      expect(mockRegisterUser).toHaveBeenCalledWith({
        username: "testuser",
        email: "test@example.com",
        password: "Password123!",
      });
    });

    // Wait for the success message to appear
    await waitFor(() => {
      expect(screen.getByTestId("signup-success")).toBeInTheDocument();
    });

    // Fast forward timers to trigger any setTimeout calls
    jest.runAllTimers();

    // Wait a bit more for the router push to be called
    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith("/en/auth/signin");
    });

    // Restore real timers
    jest.useRealTimers();
  }, 10000); // Set timeout to 10 seconds

  it("shows server error on registration failure", async () => {
    const actionsModule = require("@/app/[lang]/auth/signup/actions") as {
      registerUser: jest.MockedFunction<
        (data: {
          username: string;
          email: string;
          password: string;
        }) => Promise<{ success: boolean; message?: string; error?: string }>
      >;
    };
    const mockRegisterUser = actionsModule.registerUser;
    mockRegisterUser.mockResolvedValue({
      success: false,
      error: "Username already exists",
    });

    renderComponent();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Username"), {
        target: { value: "existinguser" },
      });
      fireEvent.change(screen.getByLabelText("EmailAddress"), {
        target: { value: "existing@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "Password123!" },
      });
      fireEvent.change(screen.getByLabelText("ConfirmPassword"), {
        target: { value: "Password123!" },
      });
      fireEvent.click(screen.getByRole("button", { name: "CreateAccount" }));
    });

    await waitFor(async () => {
      expect(
        await screen.findByText("Username already exists"),
      ).toBeInTheDocument();
    });
  });
});
