import { sameOriginRedirect } from "../safe-redirect";

const BASE = "https://cronium.example.com";

describe("sameOriginRedirect", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/dashboard/events?page=2#top", "/dashboard/events?page=2#top"],
    [`${BASE}/dashboard`, `${BASE}/dashboard`],
    [
      `${BASE}/api/mcp/oauth/authorize?client_id=x`,
      `${BASE}/api/mcp/oauth/authorize?client_id=x`,
    ],
  ])("keeps same-origin target %s", (input, expected) => {
    expect(sameOriginRedirect(input, BASE)).toBe(expected);
  });

  it.each([
    ["https://evil.example/"],
    ["//evil.example/"], // protocol-relative
    ["/\\evil.example/"], // browsers read the backslash as a slash
    ["\\\\evil.example/"],
    [`${BASE}.evil.example/`], // passes a startsWith(baseUrl) check
    [`${BASE}@evil.example/`], // userinfo, host is evil.example
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["http://cronium.example.com/"], // downgrade: a different origin
  ])("rejects %s", (input) => {
    expect(sameOriginRedirect(input, BASE)).toBeNull();
  });
});
