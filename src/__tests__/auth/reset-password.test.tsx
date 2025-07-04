"use client";

import { render, screen } from "@testing-library/react";
import ResetPassword from "@/app/[lang]/auth/reset-password/page";

// Mock the next/navigation module
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  useSearchParams: () => ({
    get: () => "test-token",
  }),
}));

// Mock the useLanguage hook
jest.mock("@/components/providers/language-provider", () => ({
  useLanguage: () => ({
    locale: "en",
    t: (key: string) => key, // Simple identity function for translations
  }),
}));

describe("ResetPassword", () => {
  it("renders the form correctly", () => {
    render(<ResetPassword />);

    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reset Password" }),
    ).toBeInTheDocument();
  });
});
