/**
 * @jest-environment node
 */
import { isPathAllowedForScopes } from "../token-scopes";

describe("isPathAllowedForScopes", () => {
  it("null scopes = full access — reserved for cookie sessions only", () => {
    expect(isPathAllowedForScopes(null, "admin.updateSystemSettings")).toBe(
      true,
    );
    expect(isPathAllowedForScopes(null, "servers.delete")).toBe(true);
  });

  it("the full scope allows any path (explicit broad token)", () => {
    expect(isPathAllowedForScopes(["full"], "admin.updateSystemSettings")).toBe(
      true,
    );
    expect(isPathAllowedForScopes(["full"], "servers.delete")).toBe(true);
    expect(isPathAllowedForScopes(["full", "mcp"], "tools.delete")).toBe(true);
  });

  it("the mcp scope allows exactly the MCP operations", () => {
    const s = ["mcp"];
    expect(isPathAllowedForScopes(s, "mcp.getCapabilities")).toBe(true);
    expect(isPathAllowedForScopes(s, "events.create")).toBe(true);
    expect(isPathAllowedForScopes(s, "events.activate")).toBe(true);
    expect(isPathAllowedForScopes(s, "workflows.create")).toBe(true);
    expect(isPathAllowedForScopes(s, "tools.getAll")).toBe(true);
    expect(isPathAllowedForScopes(s, "servers.getAll")).toBe(true);
  });

  it("the mcp scope denies everything else", () => {
    const s = ["mcp"];
    expect(isPathAllowedForScopes(s, "admin.updateSystemSettings")).toBe(false);
    expect(isPathAllowedForScopes(s, "servers.delete")).toBe(false);
    expect(isPathAllowedForScopes(s, "auth.getApiTokens")).toBe(false);
    expect(isPathAllowedForScopes(s, "tools.delete")).toBe(false);
    expect(isPathAllowedForScopes(s, "events.update")).toBe(false);
  });

  it("an empty scope list denies everything", () => {
    expect(isPathAllowedForScopes([], "events.create")).toBe(false);
    expect(isPathAllowedForScopes([], "mcp.getCapabilities")).toBe(false);
  });

  it("an unknown scope grants nothing", () => {
    expect(isPathAllowedForScopes(["bogus"], "events.create")).toBe(false);
  });
});
