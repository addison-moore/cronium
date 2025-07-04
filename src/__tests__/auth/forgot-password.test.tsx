"use client";

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ForgotPassword from "@/app/[lang]/auth/forgot-password/page";
import { LanguageProvider } from "@/components/providers/language-provider";

// Mock the next/navigation module
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

describe("ForgotPassword", () => {
  it("renders the form correctly", () => {
    render(
      <LanguageProvider>
        <ForgotPassword />
      </LanguageProvider>,
    );

    expect(screen.getByPlaceholderText("Email address")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send reset link" }),
    ).toBeInTheDocument();
  });

  it("validates an invalid email", async () => {
    render(
      <LanguageProvider>
        <ForgotPassword />
      </LanguageProvider>,
    );

    // Get the input element
    const emailInput = screen.getByPlaceholderText("Email address");

    // Change the value to an invalid email
    fireEvent.change(emailInput, {
      target: { value: "invalid-email" },
    });

    // Submit the form
    const submitButton = screen.getByRole("button", {
      name: "Send reset link",
    });
    fireEvent.click(submitButton);

    // Wait for form validation to occur
    await waitFor(() => {
      // Check that the form wasn't submitted successfully
      // We know submission was successful if "Check your email" appears
      expect(screen.queryByText("Check your email")).not.toBeInTheDocument();
    });

    // Verify that the input is still there (we're still on the form page)
    expect(emailInput).toBeInTheDocument();
  });

  it("submits the form with a valid email", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ success: true }),
      }),
    ) as jest.Mock;

    render(
      <LanguageProvider>
        <ForgotPassword />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "test@example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => {
      expect(screen.getByText("Check your email")).toBeInTheDocument();
    });
  });
});
