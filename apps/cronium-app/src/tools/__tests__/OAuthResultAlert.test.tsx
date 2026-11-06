/**
 * What a person sees when the OAuth callback sends them back to the Tools page. The
 * query string is the real one, read through a stand-in for useSearchParams that follows
 * the address, as Next's does after history.replaceState.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { OAuthResultAlert } from "../OAuthResultAlert";

function landOn(query: string) {
  window.history.replaceState(null, "", `/dashboard/tools${query}`);
  return render(<OAuthResultAlert />);
}

const details = (text: string) =>
  `?error=oauth_failed&details=${encodeURIComponent(text)}`;

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("OAuthResultAlert", () => {
  it("shows nothing on an ordinary visit, and leaves the address alone", () => {
    const { container } = landOn("?tab=other");

    expect(container).toBeEmptyDOMElement();
    expect(window.location.search).toBe("?tab=other");
  });

  it("says the account is connected", () => {
    landOn("?oauth=success");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Account connected");
    expect(alert).not.toHaveTextContent("Connect button");
  });

  it("gives the reason the callback sent", () => {
    landOn(details("Google didn't grant access: access_denied"));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't connect the account");
    expect(alert).toHaveTextContent(
      "Google didn't grant access: access_denied",
    );
    expect(alert).toHaveTextContent("start again");
  });

  it.each([
    ["invalid_state", "expired or was already used", true],
    ["oauth_callback_failed", "couldn't read the answer", true],
    ["oauth_not_configured", "isn't set up on this server", false],
    ["invalid_provider", "provider Cronium doesn't support", false],
  ])("explains %s", (code, text, canRetry) => {
    landOn(`?error=${code}`);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't connect the account");
    expect(alert).toHaveTextContent(text);
    expect(alert.textContent?.includes("start again")).toBe(canRetry);
  });

  it("still says something for a failure with no reason or an unknown code", () => {
    landOn("?error=oauth_failed");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The connection couldn't be finished.",
    );
  });

  it("only takes text from the code that carries it", () => {
    landOn("?error=invalid_state&details=Call%20this%20number");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Call this number");
  });

  it("treats the reason as text, because anyone can write this link", () => {
    const { container } = landOn(details("<img src=x onerror=alert(1)>"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "<img src=x onerror=alert(1)>",
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("takes the result off the address but keeps showing it", () => {
    const { rerender } = landOn(details("A reason"));

    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/dashboard/tools");

    // Next renders again with the emptied searchParams.
    rerender(<OAuthResultAlert />);
    expect(screen.getByRole("alert")).toHaveTextContent("A reason");
  });

  it("doesn't come back on a reload", () => {
    const { unmount } = landOn("?oauth=success");
    unmount();

    render(<OAuthResultAlert />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("goes when it's dismissed", async () => {
    landOn(details("A reason"));

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
