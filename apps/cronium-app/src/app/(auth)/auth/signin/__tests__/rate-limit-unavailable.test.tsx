/**
 * What the sign-in form and the auth error page say when Cronium couldn't check its limit on
 * attempts, as when Valkey is down or full. NextAuth hands them the limiter's code, and the
 * form used to read any code it didn't know as a wrong password.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import SignIn from "@/app/(auth)/auth/signin/signin-form";
import ErrorPage from "@/app/(auth)/auth/error/page";
import {
  RATE_LIMIT_UNAVAILABLE,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
} from "@/shared/rate-limit";

const mockLogin = jest.fn();
const mockSignIn = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("@/lib/trpc", () => ({
  trpc: {
    userAuth: {
      login: { useMutation: () => ({ mutateAsync: mockLogin }) },
    },
  },
}));

jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args) as unknown,
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams = new URLSearchParams();
});

function submitSignIn() {
  render(<SignIn />);
  fireEvent.change(screen.getByLabelText("Username or Email"), {
    target: { value: "alice" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "a-long-enough-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
}

it("says the limit couldn't be checked, not that the password is wrong", async () => {
  mockLogin.mockResolvedValue({ success: true });
  // What signIn() gives back for the route's 503.
  mockSignIn.mockResolvedValue({
    error: RATE_LIMIT_UNAVAILABLE,
    status: 503,
    ok: false,
    url: null,
  });

  submitSignIn();

  expect(
    await screen.findByText(RATE_LIMIT_UNAVAILABLE_MESSAGE),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Invalid username/email or password."),
  ).not.toBeInTheDocument();
});

it("says the same on the auth error page", () => {
  mockSearchParams = new URLSearchParams({ error: RATE_LIMIT_UNAVAILABLE });

  render(<ErrorPage />);

  expect(screen.getByText(RATE_LIMIT_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
});
