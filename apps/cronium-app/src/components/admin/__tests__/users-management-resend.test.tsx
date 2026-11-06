/**
 * The page's resend handler starts the request and returns, so this component can't
 * know how it went. It used to show "Invitation email sent successfully" regardless,
 * next to the page's own error toast when nothing was sent.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserRole, UserStatus } from "@/shared/schema";

const mockToast = jest.fn();

jest.mock("@cronium/ui", () => ({
  ...jest.requireActual<object>("@cronium/ui"),
  useToast: () => ({ toast: mockToast }),
}));

import { UsersManagement } from "../users-management";

const INVITED = {
  id: "invited-1",
  email: "invited@example.test",
  username: null,
  firstName: null,
  lastName: null,
  role: UserRole.USER,
  status: UserStatus.INVITED,
  createdAt: "2026-11-06T00:00:00.000Z",
  updatedAt: "2026-11-06T00:00:00.000Z",
  lastLogin: null,
};

function renderUsers(onResendInvitation: (id: string) => Promise<void>) {
  const unused = () => Promise.resolve();
  render(
    <UsersManagement
      users={[INVITED]}
      isLoading={false}
      onRefresh={unused}
      onInviteUser={unused}
      onDeleteUser={unused}
      onUpdateUserStatus={unused}
      onUpdateUserRole={unused}
      onResendInvitation={onResendInvitation}
      onApproveUser={unused}
      onDenyUser={unused}
    />,
  );
}

async function clickResend() {
  const user = userEvent.setup();
  const row = screen.getByRole("row", { name: /invited@example\.test/ });
  await user.click(within(row).getByRole("button"));
  await user.click(
    await screen.findByRole("menuitem", { name: /Resend Invitation/ }),
  );
}

beforeEach(() => {
  mockToast.mockClear();
});

it("leaves saying how a resend went to the page", async () => {
  const onResendInvitation = jest.fn(() => Promise.resolve());
  renderUsers(onResendInvitation);

  await clickResend();

  expect(onResendInvitation).toHaveBeenCalledWith("invited-1");
  expect(mockToast).not.toHaveBeenCalled();
});

it("still reports a handler that rejects", async () => {
  renderUsers(() => Promise.reject(new Error("It broke")));

  await clickResend();

  expect(mockToast).toHaveBeenCalledWith(
    expect.objectContaining({ description: "It broke" }),
  );
});
