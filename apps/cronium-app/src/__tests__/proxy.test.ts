/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://cronium.example.com${path}`, { headers });
}

describe("proxy page gate", () => {
  it("redirects a cookie-less dashboard page to sign-in", async () => {
    const res = await proxy(request("/dashboard/events"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/signin");
  });

  it("lets a dashboard page through with a session cookie", async () => {
    const res = await proxy(
      request("/dashboard/events", {
        cookie: "next-auth.session-token=abc",
      }),
    );
    expect(res.status).toBe(200);
  });

  // These reach their handler, which authenticates the token and answers in
  // JSON. They used to be redirected to the HTML sign-in page for lacking a
  // cookie, which made the bearer-token REST API unusable.
  it.each(["/api/events", "/api/events/1", "/api/logs", "/api/logs/1"])(
    "does not redirect a bearer-token request to %s",
    async (path) => {
      const res = await proxy(
        request(path, { authorization: "Bearer some-token" }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    },
  );
});
