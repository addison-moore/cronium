/**
 * The admin page has to say when the server refuses, and must not say it worked.
 * Its handlers used `mutate`, which returns nothing and never rejects, so everything
 * UsersManagement did after `await`ing them ran at once: "User approved successfully"
 * and "User registration denied" showed for refusals, and the invite dialog closed
 * and dropped what was typed. Its catch blocks could never run.
 *
 * react-query is real, and errors are real TRPCClientErrors. UsersManagement is real
 * too, because the bugs are between it and the page. Radix's menu is flattened,
 * because it adds nothing here, and the settings forms are stubs that keep what the
 * save returned: react-hook-form re-throws a rejection from its handler.
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { UserRole, UserStatus } from "@/shared/schema";

const mockToast = jest.fn();
const mockServer = {
  updateSystemSettings: jest.fn(),
  sendTestEmail: jest.fn(),
  inviteUser: jest.fn(),
  updateUser: jest.fn(),
  toggleUserStatus: jest.fn(),
  bulkUserOperation: jest.fn(),
  resendInvitation: jest.fn(),
  updateRolePermissions: jest.fn(),
};
const mockRefetchUsers = jest.fn();
const mockRefetchSettings = jest.fn();
let mockActiveTab = "users";
let mockSaveResult: unknown;
let mockUsersProps: { onUpdateUserRole: (id: string, role: string) => unknown };

const makeUser = (id: string, status: string): Record<string, unknown> => ({
  id,
  email: `${id}@example.com`,
  username: id,
  firstName: null,
  lastName: null,
  role: "USER",
  status,
  lastLogin: null,
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  updatedAt: new Date("2026-11-01T00:00:00.000Z"),
});
const mockUsersData = {
  users: [
    makeUser("active-user", "ACTIVE"),
    makeUser("pending-user", "PENDING"),
    makeUser("disabled-user", "DISABLED"),
  ],
};
const mockSettingsData = { data: { smtpFromEmail: "" } };
const mockRolesData = { items: [] };

jest.mock("@cronium/ui", () => {
  const passThrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    ...jest.requireActual<Record<string, unknown>>("@cronium/ui"),
    toast: (...args: unknown[]): unknown => mockToast(...args),
    useToast: () => ({
      toast: (...args: unknown[]): unknown => mockToast(...args),
    }),
    DropdownMenu: passThrough,
    DropdownMenuTrigger: () => null,
    DropdownMenuContent: passThrough,
    DropdownMenuLabel: () => null,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({
      children,
      onClick,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
    }) => <button onClick={onClick}>{children}</button>,
  };
});

jest.mock("@/hooks/useHashTabNavigation", () => ({
  useHashTabNavigation: () => ({
    activeTab: mockActiveTab,
    changeTab: jest.fn(),
  }),
}));
jest.mock("@/hooks/use-persistent-pagination", () => ({
  usePersistentPagination: () => ({
    itemsPerPage: 20,
    setItemsPerPage: jest.fn(),
  }),
}));
jest.mock("@/components/admin/system-health", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/admin", () => {
  const settingsForm =
    (label: string, values: object) =>
    ({ onSave }: { onSave: (values: object) => unknown }) => (
      <button
        onClick={() => {
          mockSaveResult = onSave(values);
        }}
      >
        {label}
      </button>
    );
  const { UsersManagement } = jest.requireActual<
    typeof import("@/components/admin/users-management")
  >("@/components/admin/users-management");
  return {
    SmtpSettings: settingsForm("Save SMTP", {
      smtpPort: "25",
      smtpFromEmail: "",
    }),
    RegistrationSettings: settingsForm("Save registration", {
      allowRegistration: true,
    }),
    AiSettings: settingsForm("Save AI", { aiEnabled: true }),
    RolesManagement: () => null,
    UsersManagement: (props: React.ComponentProps<typeof UsersManagement>) => {
      mockUsersProps = props;
      return <UsersManagement {...props} />;
    },
  };
});

jest.mock("@/lib/trpc", () => {
  const { useMutation } = jest.requireActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query");
  const procedure = (name: keyof typeof mockServer) => ({
    useMutation: (options?: object) =>
      useMutation({
        mutationFn: (input: unknown): Promise<unknown> =>
          mockServer[name](input) as Promise<unknown>,
        ...options,
      }),
  });
  return {
    trpc: {
      admin: {
        getSystemSettings: {
          useQuery: () => ({
            data: mockSettingsData,
            refetch: mockRefetchSettings,
          }),
        },
        getUsers: {
          useQuery: () => ({
            data: mockUsersData,
            isLoading: false,
            refetch: mockRefetchUsers,
          }),
        },
        getRoles: {
          useQuery: () => ({
            data: mockRolesData,
            isLoading: false,
            refetch: jest.fn(),
          }),
        },
        updateSystemSettings: procedure("updateSystemSettings"),
        sendTestEmail: procedure("sendTestEmail"),
        inviteUser: procedure("inviteUser"),
        updateUser: procedure("updateUser"),
        toggleUserStatus: procedure("toggleUserStatus"),
        bulkUserOperation: procedure("bulkUserOperation"),
        resendInvitation: procedure("resendInvitation"),
        updateRolePermissions: procedure("updateRolePermissions"),
      },
    },
  };
});

import AdminPage from "../page";

function refusal(
  message: string,
  data: Record<string, unknown> = {},
): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      message,
      code: -32003,
      data: { code: "FORBIDDEN", httpStatus: 403, zodError: null, ...data },
    },
  });
}

function renderPage(tab = "users") {
  mockActiveTab = tab;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminPage />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const rowButton = (user: string, name: string) =>
  within(
    screen.getByText(`${user}@example.com`).closest("tr") as HTMLElement,
  ).getByRole("button", { name });

const errorToast = (description: string) => ({
  title: "Error",
  description,
  variant: "destructive",
});

const titles = () =>
  mockToast.mock.calls.map(([toast]) => (toast as { title: string }).title);

const reason =
  "Two-factor authentication is required for administrator accounts.";

beforeEach(() => {
  jest.resetAllMocks();
  mockSaveResult = undefined;
});

describe("saving system settings", () => {
  it.each([
    ["smtp", "Save SMTP"],
    ["registration", "Save registration"],
    ["ai", "Save AI"],
  ])("the %s tab shows the server's reason, once", async (tab, button) => {
    mockServer.updateSystemSettings.mockRejectedValue(refusal(reason));
    const user = renderPage(tab);

    await user.click(screen.getByRole("button", { name: button }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith({
      title: "Settings not saved",
      description: reason,
      variant: "destructive",
    });
    expect(mockRefetchSettings).not.toHaveBeenCalled();
    // react-hook-form re-throws what its handler rejects with.
    await expect(mockSaveResult).resolves.toBeUndefined();
  });

  it("gives a validation failure's sentences, not its JSON", async () => {
    mockServer.updateSystemSettings.mockRejectedValue(
      refusal('[{"code":"invalid_format","path":["smtpFromEmail"]}]', {
        code: "BAD_REQUEST",
        httpStatus: 400,
        zodError: {
          formErrors: [],
          fieldErrors: { smtpFromEmail: ["Invalid email address"] },
        },
      }),
    );
    const user = renderPage("smtp");

    await user.click(screen.getByRole("button", { name: "Save SMTP" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Settings not saved",
        description: "Invalid email address",
        variant: "destructive",
      }),
    );
  });

  it("still says it saved when it does", async () => {
    mockServer.updateSystemSettings.mockResolvedValue({ success: true });
    const user = renderPage("smtp");

    await user.click(screen.getByRole("button", { name: "Save SMTP" }));

    await waitFor(() => expect(titles()).toEqual(["Settings saved"]));
    expect(mockRefetchSettings).toHaveBeenCalled();
  });
});

describe("inviting a user", () => {
  async function invite() {
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: /Invite User/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Email Address"),
      "newcomer@example.com",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /Send Invitation/ }),
    );
    return dialog;
  }

  it("shows the server's reason, once, and keeps what was typed", async () => {
    mockServer.inviteUser.mockRejectedValue(
      refusal("A user with this email already exists"),
    );

    const dialog = await invite();

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith(
      errorToast("A user with this email already exists"),
    );
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email Address")).toHaveValue(
      "newcomer@example.com",
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: /Send Invitation/ }),
      ).toBeEnabled(),
    );
    expect(mockRefetchUsers).not.toHaveBeenCalled();
  });

  it("waits for the server before closing the dialog", async () => {
    let answer: (value: unknown) => void = () => undefined;
    mockServer.inviteUser.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    const dialog = await invite();

    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /Sending/ }),
    ).toBeDisabled();

    await act(async () => {
      answer({ data: { email: "newcomer@example.com" } });
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(titles()).toEqual(["Success"]);
  });
});

describe("changing a user's status", () => {
  it.each([
    ["Disable User", "active-user", UserStatus.DISABLED],
    ["Activate User", "disabled-user", UserStatus.ACTIVE],
  ])("%s shows the server's reason, once", async (button, target, status) => {
    mockServer.toggleUserStatus.mockRejectedValue(
      refusal("You cannot disable your own account"),
    );
    const user = renderPage();

    await user.click(rowButton(target, button));

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockServer.toggleUserStatus).toHaveBeenCalledWith({
      id: target,
      status,
    });
    expect(mockToast).toHaveBeenCalledWith(
      errorToast("You cannot disable your own account"),
    );
    expect(mockRefetchUsers).not.toHaveBeenCalled();
  });

  it("Approve says only that it failed when it's refused", async () => {
    mockServer.toggleUserStatus.mockRejectedValue(refusal("User not found"));
    const user = renderPage();

    await user.click(rowButton("pending-user", "Approve"));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(errorToast("User not found"));
  });

  it("Approve says it worked only after the server agrees", async () => {
    let answer: (value: unknown) => void = () => undefined;
    mockServer.toggleUserStatus.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const user = renderPage();

    await user.click(rowButton("pending-user", "Approve"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mockToast).not.toHaveBeenCalled();

    await act(async () => {
      answer({ data: {} });
    });
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "User approved successfully" }),
      ),
    );
  });
});

describe.each([
  ["Deny", "pending-user", "User registration denied"],
  ["Delete User", "active-user", null],
] as const)("%s", (button, target, successMessage) => {
  async function perform() {
    const user = renderPage();
    await user.click(rowButton(target, button));
    if (button === "Delete User") {
      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    }
  }

  it("shows the reason, once, when the server refuses outright", async () => {
    mockServer.bulkUserOperation.mockRejectedValue(refusal(reason));

    await perform();

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(errorToast(reason));
    expect(mockRefetchUsers).not.toHaveBeenCalled();
  });

  it("shows the reason, once, when the server answers 200 and refuses in results", async () => {
    mockServer.bulkUserOperation.mockResolvedValue({
      success: true,
      total: 1,
      succeeded: 0,
      failed: 1,
      results: [
        {
          id: target,
          success: false,
          error: "Cannot perform this operation on your own account",
        },
      ],
    });

    await perform();

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      errorToast("Cannot perform this operation on your own account"),
    );
  });

  it("says something when a refusal in results has no reason", async () => {
    mockServer.bulkUserOperation.mockResolvedValue({
      success: true,
      total: 1,
      succeeded: 0,
      failed: 1,
      results: [{ id: target, success: false }],
    });

    await perform();

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith(
      errorToast("The server refused this operation"),
    );
  });

  it("asks the server about one user, in one call", async () => {
    mockServer.bulkUserOperation.mockResolvedValue({
      success: true,
      total: 1,
      succeeded: 1,
      failed: 0,
      results: [{ id: target, success: true }],
    });

    await perform();

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockServer.bulkUserOperation).toHaveBeenCalledTimes(1);
    expect(mockServer.bulkUserOperation).toHaveBeenCalledWith({
      userIds: [target],
      operation: "delete",
    });
    expect(titles()).not.toContain("Error");
    expect(titles()).not.toContain("Partial Success");
    if (successMessage) {
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ description: successMessage }),
        ),
      );
    }
    expect(mockRefetchUsers).toHaveBeenCalled();
  });
});

describe("updating a user", () => {
  // Nothing in the UI calls onUpdateUserRole today, so this goes through the prop.
  it("shows the server's reason, once", async () => {
    mockServer.updateUser.mockRejectedValue(
      refusal("You cannot change your own role"),
    );
    renderPage();

    await act(async () => {
      await mockUsersProps.onUpdateUserRole("active-user", UserRole.ADMIN);
    });

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith(
      errorToast("You cannot change your own role"),
    );
    expect(mockRefetchUsers).not.toHaveBeenCalled();
  });
});
